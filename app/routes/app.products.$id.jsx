import { useState, useEffect, useRef } from "react";
import {
  isRouteErrorResponse,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRouteError,
} from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";

const DEFAULT_CANVAS = { top: 10, left: 10, width: 20, height: 20 };
const DEFAULT_VIEWS = ["Front", "Back", "Sleeve"];
const DEFAULT_POSITION_NAMES = ["Left Chest", "Right Chest"];
const SIDE_OPTION_FIELDS = [
  "allowMultipleSelections",
  "optional",
  "enableCollapsible",
  "collapsibleHeading",
];

const createId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createSideKey = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const getPositionImageKey = (viewId, positionId) =>
  `${viewId}::position::${positionId}`;

const getViewId = (name, existingId) => {
  const sideKey = createSideKey(name);
  if (DEFAULT_VIEWS.some((viewName) => createSideKey(viewName) === sideKey)) {
    return sideKey;
  }

  return existingId || createId(sideKey || "side");
};

const createPosition = (name = "Print area") => ({
  id: createId("position"),
  name,
  addOnProduct: null,
  canvas: { ...DEFAULT_CANVAS },
});

const createView = (name) => ({
  id: getViewId(name),
  name,
  allowMultipleSelections: false,
  optional: false,
  enableCollapsible: false,
  collapsibleHeading: name,
  positions: DEFAULT_POSITION_NAMES.map(createPosition),
});

const normalizePosition = (
  position,
  index = 0,
  fallbackAddOnProduct = null,
) => ({
  id: position?.id || createId(`position-${index}`),
  name:
    position?.name ||
    DEFAULT_POSITION_NAMES[index] ||
    `Print area ${index + 1}`,
  addOnProduct:
    normalizeAddOnProduct(position?.addOnProduct) || fallbackAddOnProduct,
  canvas: {
    ...DEFAULT_CANVAS,
    ...(position?.canvas || {}),
  },
});

const normalizeAddOnProduct = (product) => {
  if (!product?.id || !product?.title) return null;

  const imageUrl =
    product.imageUrl ||
    product.image?.originalSrc ||
    product.images?.[0]?.originalSrc ||
    "";
  const variant = product.variant || product.variants?.[0] || null;

  return {
    id: product.id,
    title: product.title,
    imageUrl,
    variantId: product.variantId || variant?.id || "",
    variantTitle: product.variantTitle || variant?.displayName || "",
    price: product.price || variant?.price || variant?.price?.amount || "",
  };
};

const normalizeView = (view, fallbackName) => {
  const name = view?.name || fallbackName;
  const legacyAddOnProduct = normalizeAddOnProduct(view?.addOnProduct);
  const legacyCanvas = view?.canvas
    ? [{ name: `${name} print area`, canvas: view.canvas }]
    : null;
  const positions =
    Array.isArray(view?.positions) && view.positions.length > 0
      ? view.positions
      : legacyCanvas ||
        DEFAULT_POSITION_NAMES.map((positionName) => ({ name: positionName }));

  return {
    id: getViewId(name, view?.id),
    name,
    allowMultipleSelections: Boolean(view?.allowMultipleSelections),
    optional: Boolean(view?.optional),
    enableCollapsible: Boolean(view?.enableCollapsible),
    collapsibleHeading: view?.collapsibleHeading || name,
    positions: positions.map((position, index) =>
      normalizePosition(position, index, legacyAddOnProduct),
    ),
  };
};

const normalizeViews = (existingViews) => {
  const sourceViews = Array.isArray(existingViews) ? existingViews : [];
  return sourceViews.map((view) => normalizeView(view, "View"));
};

const viewMissingSideOptionDefaults = (view) =>
  SIDE_OPTION_FIELDS.some(
    (field) => !Object.prototype.hasOwnProperty.call(view || {}, field),
  );

const settingsMissingSideOptionDefaults = (settings) => {
  if (settings && !Array.isArray(settings) && Array.isArray(settings.views)) {
    return settings.views.some(viewMissingSideOptionDefaults);
  }

  if (Array.isArray(settings)) {
    return settings.some((group) =>
      Array.isArray(group.views)
        ? group.views.some(viewMissingSideOptionDefaults)
        : false,
    );
  }

  return false;
};

const createColorImages = (color, views) => ({
  color,
  images: views.reduce((images, view) => {
    images[view.id] = "";
    return images;
  }, {}),
});

const getExistingImage = (existingImages, view) => {
  if (!existingImages) return "";

  return (
    existingImages[view.id] ||
    existingImages[view.name] ||
    existingImages[view.name?.toLowerCase()] ||
    Object.entries(existingImages).find(([key]) =>
      key.startsWith(`${view.id}-`),
    )?.[1] ||
    ""
  );
};

const normalizeColorImages = (color, views, existing) => ({
  color,
  images: views.reduce((images, view) => {
    images[view.id] = getExistingImage(existing?.images, view);
    view.positions.forEach((position) => {
      const imageKey = getPositionImageKey(view.id, position.id);
      images[imageKey] = existing?.images?.[imageKey] || "";
    });
    return images;
  }, { ...(existing?.images || {}) }),
});

const normalizeSettings = (colors, parsed) => {
  if (parsed && !Array.isArray(parsed) && Array.isArray(parsed.views)) {
    const views = normalizeViews(parsed.views);
    const colorImages = colors.map((color) => {
      const existing = parsed.colorImages?.find((item) => item.color === color);
      return normalizeColorImages(color, views, existing);
    });

    return { views, colorImages };
  }

  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].views) {
    const firstConfiguredGroup = parsed.find((group) =>
      Array.isArray(group.views),
    );
    const views = normalizeViews(firstConfiguredGroup?.views);
    const colorImages = colors.map((color) => {
      const legacyGroup = parsed.find((group) => group.color === color);
      return {
        color,
        images: views.reduce((images, view) => {
          const legacyView = legacyGroup?.views?.find(
            (item) => item.name?.toLowerCase() === view.name.toLowerCase(),
          );
          images[view.id] = legacyView?.image || "";
          return images;
        }, {}),
      };
    });

    return { views, colorImages };
  }

  const views = [];
  return {
    views,
    colorImages: colors.map((color) => createColorImages(color, views)),
  };
};

export const loader = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;

  let response;

  try {
    response = await admin.graphql(
      `#graphql
    query getProduct($id: ID!) {
      product(id: $id) {
        id
        title
        options {
          id
          name
          values
        }
        variants(first: 100) {
          edges {
            node {
              id
              title
              selectedOptions {
                name
                value
              }
            }
          }
        }
        images(first: 50) {
          edges {
            node {
              id
              url
              altText
            }
          }
        }
        location_settings: metafield(namespace: "custom", key: "location_settings") {
          jsonValue
        }
      }
    }`,
      {
        variables: {
          id: `gid://shopify/Product/${id}`,
        },
        tries: 3,
      },
    );
  } catch (error) {
    console.error("Shopify Admin API request failed", error);
    throw new Response(
      "Could not reach Shopify Admin API. Check your internet connection and Shopify CLI tunnel, then try again.",
      {
        status: 503,
        statusText: "Shopify Admin API unavailable",
      },
    );
  }

  const responseJson = await response.json();
  const product = responseJson.data.product;

  const colorOption = product.options.find(
    (opt) =>
      opt.name.toLowerCase() === "color" || opt.name.toLowerCase() === "colour",
  );
  const colors = colorOption ? colorOption.values : ["Default"];

  let initialSettings = normalizeSettings(colors);

  const existingLocationSettings = product.location_settings?.jsonValue;
  const needsSideOptionDefaults = settingsMissingSideOptionDefaults(
    existingLocationSettings,
  );

  if (existingLocationSettings) {
    try {
      initialSettings = normalizeSettings(colors, existingLocationSettings);
    } catch (e) {
      console.error("Error parsing metafield value", e);
    }
  }

  const productImages = product.images.edges.map(({ node }) => ({
    ...node,
    altText: node.altText || product.title,
  }));

  return {
    product,
    initialSettings,
    productImages,
    needsSideOptionDefaults,
  };
};

export const action = async ({ request, params }) => {
  const { admin } = await authenticate.admin(request);
  const { id } = params;
  const formData = await request.formData();
  const settings = JSON.parse(formData.get("settings"));
  const sanitizedSettings = {
    ...settings,
    views: settings.views.map((view) => {
      const { positions, ...viewSettings } = view;
      delete viewSettings.addOnProduct;

      return {
        ...viewSettings,
        allowMultipleSelections: Boolean(view.allowMultipleSelections),
        optional: Boolean(view.optional),
        enableCollapsible: Boolean(view.enableCollapsible),
        collapsibleHeading: view.collapsibleHeading || view.name,
        positions: positions.map((position) => ({
          ...position,
          addOnProduct: normalizeAddOnProduct(position.addOnProduct),
        })),
      };
    }),
  };

  const response = await admin.graphql(
    `#graphql
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        metafields: [
          {
            ownerId: `gid://shopify/Product/${id}`,
            namespace: "custom",
            key: "location_settings",
            type: "json",
            value: JSON.stringify(sanitizedSettings),
          },
        ],
      },
      tries: 3,
    },
  );

  return await response.json();
};

export default function ProductCustomiser() {
  const { product, initialSettings, productImages, needsSideOptionDefaults } =
    useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [needsDefaultSave, setNeedsDefaultSave] = useState(
    needsSideOptionDefaults,
  );
  const [collapsedViewIds, setCollapsedViewIds] = useState(
    () => new Set(initialSettings.views.map((view) => view.id)),
  );
  const [activePositionEditor, setActivePositionEditor] = useState(null);
  const [activePicker, setActivePicker] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const pendingSaveSettings = useRef(null);

  const isSaving = fetcher.state !== "idle";
  const hasUnsavedChanges =
    needsDefaultSave ||
    JSON.stringify(settings) !== JSON.stringify(savedSettings);

  useEffect(() => {
    if (fetcher.data?.data?.metafieldsSet?.metafields?.[0]?.id) {
      if (pendingSaveSettings.current) {
        setSavedSettings(pendingSaveSettings.current);
      }
      setNeedsDefaultSave(false);
      pendingSaveSettings.current = null;
      shopify.toast.show("Settings saved successfully");
    } else if (fetcher.data?.data?.metafieldsSet?.userErrors?.length > 0) {
      pendingSaveSettings.current = null;
      shopify.toast.show(
        "Error saving: " +
          fetcher.data.data.metafieldsSet.userErrors[0].message,
      );
    }
  }, [fetcher.data, shopify]);

  const handleSave = () => {
    const serializedSettings = JSON.stringify(settings);
    pendingSaveSettings.current = settings;
    fetcher.submit({ settings: serializedSettings }, { method: "POST" });
  };

  const handleCancel = () => {
    setSettings(savedSettings);
  };

  const addView = () => {
    const view = createView("New side");
    setSettings((currentSettings) => ({
      views: [...currentSettings.views, view],
      colorImages: currentSettings.colorImages.map((colorImage) => ({
        ...colorImage,
        images: { ...colorImage.images, [view.id]: "" },
      })),
    }));
    setCollapsedViewIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(view.id);
      return nextIds;
    });
  };

  const removeView = (viewIdx) => {
    const viewId = settings.views[viewIdx].id;
    setSettings((currentSettings) => ({
      views: currentSettings.views.filter((_, index) => index !== viewIdx),
      colorImages: currentSettings.colorImages.map((colorImage) => {
        const images = { ...colorImage.images };
        delete images[viewId];
        Object.keys(images).forEach((imageKey) => {
          if (imageKey.startsWith(`${viewId}::position::`)) {
            delete images[imageKey];
          }
        });
        return { ...colorImage, images };
      }),
    }));
    setCollapsedViewIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.delete(viewId);
      return nextIds;
    });
  };

  const toggleViewCollapsed = (viewId) => {
    setCollapsedViewIds((currentIds) => {
      const nextIds = new Set(currentIds);
      if (nextIds.has(viewId)) {
        nextIds.delete(viewId);
      } else {
        nextIds.add(viewId);
      }
      return nextIds;
    });
  };

  const updateViewName = (viewIdx, name) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) =>
        index === viewIdx ? { ...view, name } : view,
      ),
    }));
  };

  const updateViewField = (viewIdx, field, value) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) =>
        index === viewIdx ? { ...view, [field]: value } : view,
      ),
    }));
  };

  const updateViewAllowMultipleSelections = (
    viewIdx,
    allowMultipleSelections,
  ) => {
    updateViewField(
      viewIdx,
      "allowMultipleSelections",
      allowMultipleSelections,
    );
  };

  const updatePositionAddOnProduct = (viewIdx, positionIdx, addOnProduct) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) => {
        if (index !== viewIdx) return view;

        return {
          ...view,
          positions: view.positions.map((position, posIndex) =>
            posIndex === positionIdx ? { ...position, addOnProduct } : position,
          ),
        };
      }),
    }));
  };

  const selectPositionAddOnProduct = async (viewIdx, positionIdx) => {
    const position = settings.views[viewIdx]?.positions?.[positionIdx];
    const selectionIds = position?.addOnProduct?.id
      ? [
          {
            id: position.addOnProduct.id,
            variants: position.addOnProduct.variantId
              ? [{ id: position.addOnProduct.variantId }]
              : undefined,
          },
        ]
      : [];

    const selected = await shopify.resourcePicker({
      type: "product",
      action: "select",
      multiple: false,
      selectionIds,
    });

    const selectedProduct = selected?.[0];
    if (!selectedProduct) return;

    const selectedVariant = selectedProduct.variants?.[0];
    updatePositionAddOnProduct(
      viewIdx,
      positionIdx,
      normalizeAddOnProduct({
        ...selectedProduct,
        variant: selectedVariant,
      }),
    );
  };

  const clearPositionAddOnProduct = (viewIdx, positionIdx) => {
    updatePositionAddOnProduct(viewIdx, positionIdx, null);
  };

  const addPosition = (viewIdx) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) => {
        if (index !== viewIdx) return view;
        return {
          ...view,
          positions: [
            ...view.positions,
            createPosition(`Print area ${view.positions.length + 1}`),
          ],
        };
      }),
    }));
  };

  const removePosition = (viewIdx, positionIdx) => {
    const view = settings.views[viewIdx];
    const positionId = view?.positions?.[positionIdx]?.id;
    const imageKey = positionId ? getPositionImageKey(view.id, positionId) : "";

    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) => {
        if (index !== viewIdx) return view;
        return {
          ...view,
          positions: view.positions.filter(
            (_, posIndex) => posIndex !== positionIdx,
          ),
        };
      }),
      colorImages: currentSettings.colorImages.map((colorImage) => {
        const images = { ...colorImage.images };
        if (imageKey) {
          delete images[imageKey];
        }
        return { ...colorImage, images };
      }),
    }));
  };

  const updatePositionField = (viewIdx, positionIdx, field, value) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) => {
        if (index !== viewIdx) return view;
        return {
          ...view,
          positions: view.positions.map((position, posIndex) =>
            posIndex === positionIdx
              ? { ...position, [field]: value }
              : position,
          ),
        };
      }),
    }));
  };

  const updateCanvasField = (viewIdx, positionIdx, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;

    setSettings((currentSettings) => ({
      ...currentSettings,
      views: currentSettings.views.map((view, index) => {
        if (index !== viewIdx) return view;
        return {
          ...view,
          positions: view.positions.map((position, posIndex) =>
            posIndex === positionIdx
              ? {
                  ...position,
                  canvas: { ...position.canvas, [field]: numValue },
                }
              : position,
          ),
        };
      }),
    }));
  };

  const clearImage = (colorIdx, imageKey) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      colorImages: currentSettings.colorImages.map((colorImage, index) =>
        index === colorIdx
          ? {
              ...colorImage,
              images: { ...colorImage.images, [imageKey]: "" },
            }
          : colorImage,
      ),
    }));
  };

  const assignImage = (colorIdx, imageKey, imageUrl) => {
    setSettings((currentSettings) => ({
      ...currentSettings,
      colorImages: currentSettings.colorImages.map((colorImage, index) =>
        index === colorIdx
          ? {
              ...colorImage,
              images: {
                ...colorImage.images,
                [imageKey]: imageUrl,
              },
            }
          : colorImage,
      ),
    }));
  };

  const selectImage = (imageUrl) => {
    if (!activePicker) return;

    assignImage(activePicker.colorIdx, activePicker.imageKey, imageUrl);
    setActivePicker(null);
  };

  const uploadImageForTarget = async (event, targetPicker = activePicker) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file || !targetPicker) return;

    setUploadingImage(true);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("fileName", `customized-product-${Date.now()}`);

      const response = await fetch("/api/cloudinary", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result.imageUrl) {
        throw new Error(result.error || "Image upload failed");
      }

      assignImage(targetPicker.colorIdx, targetPicker.imageKey, result.imageUrl);
      setActivePicker(null);
      shopify.toast.show("Image uploaded successfully");
    } catch (error) {
      console.error("Cloudinary upload failed", error);
      shopify.toast.show(error.message || "Image upload failed");
    } finally {
      setUploadingImage(false);
    }
  };

  const uploadImage = (event) => uploadImageForTarget(event);

  const getImageForView = (colorIdx, viewId) =>
    settings.colorImages[colorIdx]?.images?.[viewId] || "";

  const getImageForPosition = (colorIdx, viewId, positionId) =>
    settings.colorImages[colorIdx]?.images?.[
      getPositionImageKey(viewId, positionId)
    ] ||
    getImageForView(colorIdx, viewId) ||
    "";

  const hasPositionImageOverride = (colorIdx, viewId, positionId) =>
    Boolean(
      settings.colorImages[colorIdx]?.images?.[
        getPositionImageKey(viewId, positionId)
      ],
    );

  const getOverlayOptionsForColor = (colorName = "") => {
    const normalizedColor = colorName.trim().toLowerCase();
    const darkColorTerms = [
      "black",
      "navy",
      "blue",
      "red",
      "green",
      "purple",
      "maroon",
      "brown",
      "charcoal",
      "dark",
    ];
    const lightColorTerms = [
      "white",
      "cream",
      "ivory",
      "yellow",
      "grey",
      "gray",
      "silver",
      "light",
      "natural",
    ];
    const isDarkSurface =
      darkColorTerms.some((term) => normalizedColor.includes(term)) &&
      !lightColorTerms.some((term) => normalizedColor.includes(term));

    return {
      textColor: isDarkSurface ? "#f6f6f7" : "#202223",
      textShadow: isDarkSurface ? "0 1px 2px rgba(0, 0, 0, 0.55)" : "none",
    };
  };

  const renderPositionOverlay = (position, options = {}) => {
    const { compact = false, textColor = "#202223", textShadow = "none" } =
      options;

    return (
      <div
        title={position.name}
        style={{
          position: "absolute",
          top: `${position.canvas.top}%`,
          left: `${position.canvas.left}%`,
          width: `${position.canvas.width}%`,
          height: `${position.canvas.height}%`,
          border: compact ? "1px dashed #008060" : "2px dashed #008060",
          backgroundColor: compact
            ? "rgba(0, 128, 96, 0.08)"
            : "rgba(0, 128, 96, 0.12)",
          color: textColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: compact ? "0" : "10px",
          fontWeight: 600,
          lineHeight: compact ? "0" : "12px",
          overflow: "hidden",
          padding: compact ? "0" : "2px",
          pointerEvents: "none",
          textAlign: "center",
          textShadow,
          wordBreak: "break-word",
        }}
      >
        {!compact && position.name}
      </div>
    );
  };

  const renderImagePreview = (
    imageUrl,
    altText,
    positions,
    size = "200px",
    imageStyle = {},
    overlayOptions = {},
  ) => (
    <div
      style={{
        width: size,
        maxWidth: "100%",
        position: "relative",
        border: "1px solid #e3e3e3",
        borderRadius: "6px",
        backgroundColor: "#f6f6f7",
        overflow: "hidden",
      }}
    >
      <img
        src={imageUrl}
        alt={altText}
        style={{
          width: "100%",
          display: "block",
          objectFit: "contain",
          ...imageStyle,
        }}
      />
      {positions.map((position) =>
        renderPositionOverlay(position, overlayOptions),
      )}
    </div>
  );

  const renderUploadButton = (colorIdx, imageKey, hasImage) => (
    <s-button
      disabled={uploadingImage}
      {...(uploadingImage ? { loading: true } : {})}
    >
      <label
        style={{
          cursor: uploadingImage ? "default" : "pointer",
        }}
      >
        {hasImage ? "Change File" : "Add File"}
        <input
          type="file"
          accept="image/*"
          disabled={uploadingImage}
          onChange={(event) =>
            uploadImageForTarget(event, { colorIdx, imageKey })
          }
          style={{ display: "none" }}
        />
      </label>
    </s-button>
  );

  const renderImageActions = ({
    colorIdx,
    imageKey,
    hasImage,
    onPick,
    onClear,
    includeEdit,
    onEdit,
  }) => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        justifyContent: "flex-end",
      }}
    >
      {renderUploadButton(colorIdx, imageKey, hasImage)}
      <s-button variant="tertiary" onClick={onPick}>
        Library
      </s-button>
      {includeEdit && (
        <s-button variant="tertiary" onClick={onEdit}>
          Edit Area
        </s-button>
      )}
      {hasImage && (
        <s-button variant="tertiary" tone="critical" onClick={onClear}>
          Remove
        </s-button>
      )}
    </div>
  );

  const renderEmptyImageState = (label) => (
    <div
      style={{
        minHeight: "220px",
        border: "1px dashed #c9cccf",
        borderRadius: "6px",
        backgroundColor: "#fafafa",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        textAlign: "center",
      }}
    >
      <s-text color="subdued">{label}</s-text>
    </div>
  );

  const renderSideImagesForView = (view, viewIdx) => (
    <s-box padding="base" background="subdued" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="none">
          <s-heading>Images for this block</s-heading>
          <s-text color="subdued">
            Manage the base side image and optional area-specific images for
            each color.
          </s-text>
        </s-stack>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "20px",
          }}
        >
          {settings.colorImages.map((colorImage, colorIdx) => {
            const viewImageKey = view.id;
            const selectedImage = getImageForView(colorIdx, view.id);
            const pickerIsActive =
              activePicker?.colorIdx === colorIdx &&
              activePicker?.imageKey === viewImageKey;

            return (
              <div
                key={`${view.id}-${colorImage.color}`}
                style={{
                  border: "1px solid #e3e3e3",
                  borderRadius: "8px",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                  backgroundColor: "#fff",
                  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
                }}
              >
                <div
                  style={{
                    padding: "14px 16px",
                    borderBottom: "1px solid #e3e3e3",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "12px",
                  }}
                >
                  <s-stack direction="block" gap="none">
                    <s-text type="strong">{colorImage.color}</s-text>
                    <s-text color="subdued">{view.name} image</s-text>
                  </s-stack>
                  {renderImageActions({
                    colorIdx,
                    imageKey: viewImageKey,
                    hasImage: Boolean(selectedImage),
                    onPick: () =>
                      setActivePicker({
                        colorIdx,
                        imageKey: viewImageKey,
                      }),
                    onClear: () => clearImage(colorIdx, view.id),
                  })}
                </div>

                <div
                  style={{
                    padding: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "14px",
                  }}
                >
                  {selectedImage
                      ? renderImagePreview(
                          selectedImage,
                          `${colorImage.color} ${view.name}`,
                          view.positions,
                          "100%",
                          {},
                          getOverlayOptionsForColor(colorImage.color),
                        )
                    : renderEmptyImageState(`Add a ${view.name} image`)}

                  {pickerIsActive && renderImagePicker(selectedImage)}

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    {view.positions.map((position, positionIdx) => {
                      const positionImageKey = getPositionImageKey(
                        view.id,
                        position.id,
                      );
                      const positionImage = getImageForPosition(
                        colorIdx,
                        view.id,
                        position.id,
                      );
                      const hasOverride = hasPositionImageOverride(
                        colorIdx,
                        view.id,
                        position.id,
                      );
                      const positionPickerIsActive =
                        activePicker?.colorIdx === colorIdx &&
                        activePicker?.imageKey === positionImageKey;

                      return (
                        <div
                          key={position.id}
                          style={{
                            border: "1px solid #e3e3e3",
                            borderRadius: "8px",
                            padding: "10px",
                            backgroundColor: "#fafafa",
                          }}
                        >
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "104px minmax(0, 1fr)",
                              gap: "12px",
                              alignItems: "start",
                            }}
                          >
                            {positionImage ? (
                              renderImagePreview(
                                positionImage,
                                `${colorImage.color} ${view.name} ${position.name}`,
                                [position],
                                "104px",
                                {},
                                {
                                  compact: true,
                                  ...getOverlayOptionsForColor(
                                    colorImage.color,
                                  ),
                                },
                              )
                            ) : (
                              <div
                                style={{
                                  width: "104px",
                                  height: "104px",
                                  border: "1px dashed #c9cccf",
                                  borderRadius: "6px",
                                  backgroundColor: "#fff",
                                }}
                              />
                            )}

                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                minWidth: 0,
                              }}
                            >
                              <s-stack direction="block" gap="none">
                                <s-text type="strong">{position.name}</s-text>
                                <s-text color="subdued">
                                  {hasOverride
                                    ? "Custom area image"
                                    : `Using ${view.name} image`}
                                </s-text>
                              </s-stack>

                              {renderImageActions({
                                colorIdx,
                                imageKey: positionImageKey,
                                hasImage: hasOverride,
                                includeEdit: true,
                                onPick: () =>
                                  setActivePicker({
                                    colorIdx,
                                    imageKey: positionImageKey,
                                  }),
                                onClear: () =>
                                  clearImage(colorIdx, positionImageKey),
                                onEdit: () =>
                                  setActivePositionEditor({
                                    viewIdx,
                                    positionIdx,
                                  }),
                              })}
                            </div>
                          </div>

                          {positionPickerIsActive && (
                            <div style={{ marginTop: "10px" }}>
                              {renderImagePicker(positionImage)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </s-stack>
    </s-box>
  );

  const renderPositionEditor = () => {
    if (!activePositionEditor) return null;

    const { viewIdx, positionIdx } = activePositionEditor;
    const view = settings.views[viewIdx];
    const position = view?.positions?.[positionIdx];
    if (!view || !position) return null;

    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="position-editor-title"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          backgroundColor: "rgba(0, 0, 0, 0.42)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <div
          style={{
            width: "min(1040px, 100%)",
            maxHeight: "calc(100vh - 48px)",
            overflow: "auto",
            backgroundColor: "#fff",
            borderRadius: "8px",
            boxShadow: "0 24px 64px rgba(0, 0, 0, 0.22)",
            padding: "20px",
          }}
        >
          <s-stack direction="block" gap="base">
            <s-stack
              direction="inline"
              justifyContent="space-between"
              alignItems="center"
              gap="base"
            >
              <s-stack direction="block" gap="none">
                <s-heading id="position-editor-title">
                  Edit {position.name}
                </s-heading>
                <s-text color="subdued">{view.name}</s-text>
              </s-stack>
              <s-button
                variant="tertiary"
                onClick={() => setActivePositionEditor(null)}
              >
                Close
              </s-button>
            </s-stack>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(96px, 1fr))",
                gap: "8px",
              }}
            >
              <s-number-field
                label="Top %"
                value={String(position.canvas.top)}
                onChange={(e) =>
                  updateCanvasField(
                    viewIdx,
                    positionIdx,
                    "top",
                    e.currentTarget.value,
                  )
                }
              />
              <s-number-field
                label="Left %"
                value={String(position.canvas.left)}
                onChange={(e) =>
                  updateCanvasField(
                    viewIdx,
                    positionIdx,
                    "left",
                    e.currentTarget.value,
                  )
                }
              />
              <s-number-field
                label="Width %"
                value={String(position.canvas.width)}
                onChange={(e) =>
                  updateCanvasField(
                    viewIdx,
                    positionIdx,
                    "width",
                    e.currentTarget.value,
                  )
                }
              />
              <s-number-field
                label="Height %"
                value={String(position.canvas.height)}
                onChange={(e) =>
                  updateCanvasField(
                    viewIdx,
                    positionIdx,
                    "height",
                    e.currentTarget.value,
                  )
                }
              />
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
                gap: "16px",
              }}
            >
              {settings.colorImages.map((colorImage, colorIdx) => {
                const previewImage = getImageForPosition(
                  colorIdx,
                  view.id,
                  position.id,
                );
                const hasOverride = hasPositionImageOverride(
                  colorIdx,
                  view.id,
                  position.id,
                );
                const positionImageKey = getPositionImageKey(
                  view.id,
                  position.id,
                );
                const pickerIsActive =
                  activePicker?.colorIdx === colorIdx &&
                  activePicker?.imageKey === positionImageKey;

                return (
                  <div
                    key={`${view.id}-${position.id}-${colorImage.color}`}
                    style={{
                      border: "1px solid #e3e3e3",
                      borderRadius: "6px",
                      padding: "12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "10px",
                    }}
                  >
                    <s-stack
                      direction="inline"
                      justifyContent="space-between"
                      alignItems="center"
                      gap="base"
                    >
                      <s-stack direction="block" gap="none">
                        <s-text type="strong">{colorImage.color}</s-text>
                        <s-text color="subdued">
                          {hasOverride
                            ? "Custom image for this position"
                            : `Using ${view.name} image`}
                        </s-text>
                      </s-stack>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: "8px",
                          justifyContent: "flex-end",
                        }}
                      >
                        {renderUploadButton(
                          colorIdx,
                          positionImageKey,
                          hasOverride,
                        )}
                        <s-button
                          onClick={() =>
                            setActivePicker({
                              colorIdx,
                              imageKey: positionImageKey,
                            })
                          }
                        >
                          {hasOverride ? "Change Image" : "Pick Image"}
                        </s-button>
                        {hasOverride && (
                          <s-button
                            variant="tertiary"
                            tone="critical"
                            onClick={() => clearImage(colorIdx, positionImageKey)}
                          >
                            Clear
                          </s-button>
                        )}
                      </div>
                    </s-stack>

                    {previewImage ? (
                      renderImagePreview(
                        previewImage,
                        `${colorImage.color} ${view.name} ${position.name}`,
                        [position],
                        "100%",
                        {},
                        getOverlayOptionsForColor(colorImage.color),
                      )
                    ) : (
                      <s-box
                        padding="base"
                        background="subdued"
                        border="base"
                        borderRadius="base"
                      >
                        <s-text color="subdued">
                          Pick a block image to preview this position.
                        </s-text>
                      </s-box>
                    )}

                    {pickerIsActive && renderImagePicker(previewImage)}
                  </div>
                );
              })}
            </div>
          </s-stack>
        </div>
      </div>
    );
  };

  const renderImagePicker = (selectedImage) => (
    <s-box padding="base" background="subdued" border="base" borderRadius="base">
      <s-stack direction="block" gap="base">
        <s-stack
          direction="inline"
          justifyContent="space-between"
          alignItems="center"
        >
          <s-text type="strong">Select Image</s-text>
          <s-button-group>
            <s-button
              disabled={uploadingImage}
              {...(uploadingImage ? { loading: true } : {})}
            >
              <label
                style={{
                  cursor: uploadingImage ? "default" : "pointer",
                }}
              >
                Upload image
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploadingImage}
                  onChange={uploadImage}
                  style={{ display: "none" }}
                />
              </label>
            </s-button>
            <s-button variant="tertiary" onClick={() => setActivePicker(null)}>
              Close
            </s-button>
          </s-button-group>
        </s-stack>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
            gap: "8px",
          }}
        >
          {productImages.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => selectImage(img.url)}
              style={{
                cursor: "pointer",
                border:
                  selectedImage === img.url
                    ? "2px solid #008060"
                    : "1px solid #ddd",
                borderRadius: "4px",
                padding: "2px",
                background: "transparent",
                lineHeight: 0,
              }}
            >
              <img
                src={img.url}
                alt={img.altText}
                style={{
                  width: "100%",
                  display: "block",
                }}
              />
            </button>
          ))}
        </div>
      </s-stack>
    </s-box>
  );

  return (
    <s-page heading={product.title}>
      <s-button slot="breadcrumb-actions" onClick={() => navigate("/app")}>
        Products
      </s-button>
      {(hasUnsavedChanges || isSaving) && (
        <>
          <s-button
            slot="secondary-actions"
            onClick={handleCancel}
            disabled={isSaving}
          >
            Cancel
          </s-button>
          <s-button
            slot="primary-action"
            variant="primary"
            onClick={handleSave}
            {...(isSaving ? { loading: true } : {})}
          >
            Save Customizations
          </s-button>
        </>
      )}

      <s-stack direction="block" gap="base">
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="none">
              <s-heading>Product sides and print positions</s-heading>
              <s-text color="subdued">
                Configure each customisation block, its selectable print areas,
                and the add-on product attached to each area.
              </s-text>
            </s-stack>
            {settings.views.map((view, viewIdx) => {
              const isCollapsed = collapsedViewIds.has(view.id);

              return (
                <div
                  key={view.id}
                  style={{
                    border: isCollapsed
                      ? "1px solid #d4d4d8"
                      : "1px solid #b7babf",
                    borderRadius: "8px",
                    backgroundColor: isCollapsed ? "#fff" : "#f6f6f7",
                    display: "flex",
                    flexDirection: "column",
                    overflow: "hidden",
                    boxShadow: isCollapsed
                      ? "0 1px 2px rgba(0, 0, 0, 0.04)"
                      : "0 2px 8px rgba(0, 0, 0, 0.07)",
                  }}
                >
                  <div
                    style={{
                      padding: "16px 18px 16px 14px",
                      borderBottom: isCollapsed ? "none" : "1px solid #d4d4d8",
                      borderLeft: isCollapsed
                        ? "4px solid #8c9196"
                        : "4px solid #008060",
                      backgroundColor: isCollapsed ? "#fafafa" : "#eef6f3",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "16px",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ flexGrow: 1, maxWidth: "380px" }}>
                      <s-text-field
                        label="Side name"
                        value={view.name}
                        onChange={(e) =>
                          updateViewName(viewIdx, e.currentTarget.value)
                        }
                        autocomplete="off"
                      />
                    </div>
                    <s-stack
                      direction="inline"
                      alignItems="center"
                      gap="small"
                    >
                      <s-button
                        variant="primary"
                        onClick={() => toggleViewCollapsed(view.id)}
                      >
                        {isCollapsed ? "Expand" : "Collapse"}
                      </s-button>
                      <s-button
                        tone="critical"
                        onClick={() => removeView(viewIdx)}
                      >
                        Remove Side
                      </s-button>
                    </s-stack>
                  </div>

                  {!isCollapsed && (
                    <>
                      <div
                        style={{
                          margin: "16px",
                          padding: "16px",
                          border: "1px solid #e3e3e3",
                          borderRadius: "8px",
                          backgroundColor: "#fff",
                          display: "flex",
                          flexDirection: "column",
                          gap: "16px",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns:
                              "repeat(auto-fit, minmax(280px, 1fr))",
                            gap: "12px",
                          }}
                        >
                          <label
                            style={{
                              border: view.allowMultipleSelections
                                ? "1px solid #008060"
                                : "1px solid #e3e3e3",
                              borderRadius: "8px",
                              backgroundColor: view.allowMultipleSelections
                                ? "rgba(0, 128, 96, 0.06)"
                                : "#fafafa",
                              padding: "14px",
                              display: "flex",
                              alignItems: "flex-start",
                              gap: "10px",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              aria-label="Multi-option selector"
                              checked={view.allowMultipleSelections}
                              onChange={(event) =>
                                updateViewAllowMultipleSelections(
                                  viewIdx,
                                  event.currentTarget.checked,
                                )
                              }
                              style={{ marginTop: "3px" }}
                            />
                            <span
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px",
                              }}
                            >
                              <span style={{ fontWeight: 600 }}>
                                Multi-option selector
                              </span>
                              <span style={{ color: "#6d7175" }}>
                                Allow customers to select more than one option
                                in this block.
                              </span>
                            </span>
                          </label>

                          <div
                            style={{
                              border: view.enableCollapsible
                                ? "1px solid #008060"
                                : "1px solid #e3e3e3",
                              borderRadius: "8px",
                              backgroundColor: view.enableCollapsible
                                ? "rgba(0, 128, 96, 0.06)"
                                : "#fafafa",
                              padding: "14px",
                              display: "flex",
                              flexDirection: "column",
                              gap: "12px",
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "10px",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                aria-label="Enable collapsible block"
                                checked={view.enableCollapsible}
                                onChange={(event) =>
                                  updateViewField(
                                    viewIdx,
                                    "enableCollapsible",
                                    event.currentTarget.checked,
                                  )
                                }
                                style={{ marginTop: "3px" }}
                              />
                              <span
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "4px",
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>
                                  Collapsible block
                                </span>
                                <span style={{ color: "#6d7175" }}>
                                  Use this side inside a collapsible frontend
                                  tab.
                                </span>
                              </span>
                            </label>
                            <s-text-field
                              label="Collapsible heading"
                              value={view.collapsibleHeading}
                              onChange={(event) =>
                                updateViewField(
                                  viewIdx,
                                  "collapsibleHeading",
                                  event.currentTarget.value,
                                )
                              }
                              autocomplete="off"
                            />
                          </div>
                        </div>

                        <s-stack direction="block" gap="base">
                          {view.positions.map((position, positionIdx) => (
                            <div
                              key={position.id}
                              style={{
                                border: "1px solid #e3e3e3",
                                borderRadius: "8px",
                                display: "flex",
                                flexDirection: "column",
                                overflow: "hidden",
                              }}
                            >
                              <div
                                style={{
                                  padding: "12px 14px",
                                  borderBottom: "1px solid #e3e3e3",
                                  backgroundColor: "#fafafa",
                                  display: "flex",
                                  gap: "12px",
                                  alignItems: "end",
                                }}
                              >
                                <div style={{ flexGrow: 1 }}>
                                  <s-text-field
                                    label="Position name"
                                    value={position.name}
                                    onChange={(e) =>
                                      updatePositionField(
                                        viewIdx,
                                        positionIdx,
                                        "name",
                                        e.currentTarget.value,
                                      )
                                    }
                                    autocomplete="off"
                                  />
                                </div>
                                <s-button
                                  tone="critical"
                                  disabled={view.positions.length === 1}
                                  onClick={() =>
                                    removePosition(viewIdx, positionIdx)
                                  }
                                >
                                  Remove
                                </s-button>
                              </div>

                              <div
                                style={{
                                  padding: "14px",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: "12px",
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "8px",
                                  }}
                                >
                                  {[
                                    ["Top", position.canvas.top],
                                    ["Left", position.canvas.left],
                                    ["Width", position.canvas.width],
                                    ["Height", position.canvas.height],
                                  ].map(([label, value]) => (
                                    <span
                                      key={label}
                                      style={{
                                        border: "1px solid #e3e3e3",
                                        borderRadius: "999px",
                                        backgroundColor: "#f6f6f7",
                                        color: "#6d7175",
                                        fontSize: "12px",
                                        fontWeight: 600,
                                        padding: "4px 10px",
                                      }}
                                    >
                                      {label}: {value}%
                                    </span>
                                  ))}
                                </div>

                                <div
                                  style={{
                                    border: "1px solid #e3e3e3",
                                    borderRadius: "8px",
                                    backgroundColor: "#fafafa",
                                    padding: "12px",
                                  }}
                                >
                                  <s-stack direction="block" gap="small">
                                    <s-text type="strong">
                                      Option add-on product
                                    </s-text>
                                    {position.addOnProduct ? (
                                      <s-stack
                                        direction="inline"
                                        alignItems="center"
                                        justifyContent="space-between"
                                        gap="base"
                                      >
                                        <s-stack
                                          direction="inline"
                                          alignItems="center"
                                          gap="base"
                                        >
                                          <s-thumbnail
                                            src={
                                              position.addOnProduct.imageUrl
                                            }
                                            alt={position.addOnProduct.title}
                                            size="small"
                                          />
                                          <s-stack direction="block" gap="none">
                                            <s-text type="strong">
                                              {position.addOnProduct.title}
                                            </s-text>
                                            {position.addOnProduct
                                              .variantTitle && (
                                              <s-text color="subdued">
                                                {
                                                  position.addOnProduct
                                                    .variantTitle
                                                }
                                              </s-text>
                                            )}
                                          </s-stack>
                                        </s-stack>
                                        <s-stack
                                          direction="inline"
                                          alignItems="center"
                                          gap="small"
                                        >
                                          <s-button
                                            variant="primary"
                                            onClick={() =>
                                              selectPositionAddOnProduct(
                                                viewIdx,
                                                positionIdx,
                                              )
                                            }
                                          >
                                            Replace
                                          </s-button>
                                          <s-button
                                            tone="critical"
                                            icon="delete"
                                            onClick={() =>
                                              clearPositionAddOnProduct(
                                                viewIdx,
                                                positionIdx,
                                              )
                                            }
                                          >
                                            Remove Product
                                          </s-button>
                                        </s-stack>
                                      </s-stack>
                                    ) : (
                                      <s-stack
                                        direction="inline"
                                        alignItems="center"
                                        justifyContent="space-between"
                                        gap="base"
                                      >
                                        <s-text color="subdued">
                                          Select the product that should be
                                          added when this option is selected.
                                        </s-text>
                                        <s-button
                                          variant="primary"
                                          onClick={() =>
                                            selectPositionAddOnProduct(
                                              viewIdx,
                                              positionIdx,
                                            )
                                          }
                                        >
                                          Select add-on product
                                        </s-button>
                                      </s-stack>
                                    )}
                                  </s-stack>
                                </div>
                              </div>
                            </div>
                          ))}
                          <div>
                            <s-button
                              variant="primary"
                              onClick={() => addPosition(viewIdx)}
                            >
                              Add Position
                            </s-button>
                          </div>
                        </s-stack>
                      </div>
                      {renderSideImagesForView(view, viewIdx)}
                    </>
                  )}
                </div>
              );
            })}
            <div>
              <s-button variant="primary" onClick={addView}>
                Add Side
              </s-button>
            </div>
          </s-stack>
        </s-section>

      </s-stack>
      {renderPositionEditor()}
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? error.data
    : error?.message || "Something went wrong while loading this product.";

  return (
    <s-page heading="Product customiser unavailable">
      <s-section>
        <s-stack direction="block" gap="base">
          <s-banner heading="Could not load product" tone="critical">
            {message}
          </s-banner>
          <s-button onClick={() => window.location.reload()}>Retry</s-button>
        </s-stack>
      </s-section>
    </s-page>
  );
}
