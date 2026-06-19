import { useEffect, useRef, useState } from "react";
import { useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

const DEFAULT_CANVAS = { top: 10, left: 10, width: 20, height: 20 };
const DEFAULT_POSITION_NAMES = ["Left Chest", "Right Chest"];
const TEMPLATE_NAMESPACE = "custom";
const TEMPLATE_KEY = "product_templates";

const createId = (prefix) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createSideKey = (name) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const normalizePrice = (price) => {
  if (price === null || price === undefined || price === "") return "";
  if (typeof price === "object") return price.amount || price.value || "";
  return String(price);
};

const toShopifyGid = (resourceType, id) => {
  if (!id) return "";
  const stringId = String(id);

  if (stringId.startsWith("gid://shopify/")) return stringId;

  const numericId = stringId.match(/\d+$/)?.[0];
  return numericId ? `gid://shopify/${resourceType}/${numericId}` : stringId;
};

const getFirstVariant = (variants) => {
  if (Array.isArray(variants)) return variants[0] || null;

  if (Array.isArray(variants?.nodes)) return variants.nodes[0] || null;

  if (Array.isArray(variants?.edges)) return variants.edges[0]?.node || null;

  return null;
};

const normalizeAddOnProduct = (product) => {
  if (!product?.id || !product?.title) return null;

  const imageUrl =
    product.imageUrl ||
    product.image?.url ||
    product.image?.originalSrc ||
    product.featuredImage?.url ||
    product.images?.[0]?.originalSrc ||
    product.images?.[0]?.url ||
    "";
  const variant = product.variant || getFirstVariant(product.variants);

  return {
    id: toShopifyGid("Product", product.id),
    title: product.title,
    imageUrl,
    variantId: toShopifyGid("ProductVariant", product.variantId || variant?.id),
    variantTitle:
      product.variantTitle || variant?.displayName || variant?.title || "",
    price: normalizePrice(product.price || variant?.price),
  };
};

const createPosition = (name = "Print area", canvas = DEFAULT_CANVAS) => ({
  id: createId("position"),
  name,
  previewImage: "",
  addOnProduct: null,
  canvas: { ...DEFAULT_CANVAS, ...canvas },
});

const createView = (name, positions = DEFAULT_POSITION_NAMES) => ({
  id: createSideKey(name) || createId("side"),
  name,
  previewImage: "",
  allowMultipleSelections: false,
  optional: false,
  enableCollapsible: false,
  collapsibleHeading: name,
  positions: positions.map((position) =>
    typeof position === "string"
      ? createPosition(position)
      : createPosition(position.name, position.canvas),
  ),
});

const normalizePosition = (position, index = 0) => ({
  id: position?.id || createId(`position-${index}`),
  name:
    position?.name ||
    DEFAULT_POSITION_NAMES[index] ||
    `Print area ${index + 1}`,
  addOnProduct: normalizeAddOnProduct(position?.addOnProduct),
  previewImage: position?.previewImage || "",
  canvas: { ...DEFAULT_CANVAS, ...(position?.canvas || {}) },
});

const normalizeView = (view, index = 0) => {
  const name = view?.name || `Side ${index + 1}`;
  const positions =
    Array.isArray(view?.positions) && view.positions.length > 0
      ? view.positions
      : DEFAULT_POSITION_NAMES.map((positionName) => ({ name: positionName }));

  return {
    id: view?.id || createSideKey(name) || createId(`side-${index}`),
    name,
    previewImage: view?.previewImage || "",
    allowMultipleSelections: Boolean(view?.allowMultipleSelections),
    optional: Boolean(view?.optional),
    enableCollapsible: Boolean(view?.enableCollapsible),
    collapsibleHeading: view?.collapsibleHeading || name,
    positions: positions.map(normalizePosition),
  };
};

const createDefaultTemplates = () => [
  {
    id: "template-t-shirt",
    name: "T-Shirt",
    settings: {
      views: [
        createView("Front", [
          { name: "Left Chest", canvas: { top: 18, left: 52, width: 20, height: 20 } },
          { name: "Right Chest", canvas: { top: 18, left: 28, width: 20, height: 20 } },
        ]),
        createView("Back", [
          { name: "Upper Back", canvas: { top: 16, left: 38, width: 24, height: 18 } },
          { name: "Full Back", canvas: { top: 28, left: 30, width: 40, height: 44 } },
        ]),
        createView("Sleeve", [
          { name: "Sleeve Print", canvas: { top: 30, left: 34, width: 32, height: 24 } },
        ]),
      ],
    },
  },
  {
    id: "template-trouser",
    name: "Trouser",
    settings: {
      views: [
        createView("Front", [
          { name: "Left Leg", canvas: { top: 28, left: 54, width: 18, height: 22 } },
          { name: "Right Leg", canvas: { top: 28, left: 28, width: 18, height: 22 } },
        ]),
        createView("Back", [
          { name: "Back Pocket", canvas: { top: 18, left: 38, width: 24, height: 18 } },
        ]),
      ],
    },
  },
  {
    id: "template-cap-hat",
    name: "Cap/Hat",
    settings: {
      views: [
        createView("Front", [
          { name: "Front Panel", canvas: { top: 34, left: 34, width: 32, height: 22 } },
        ]),
        createView("Back", [
          { name: "Back Strap", canvas: { top: 42, left: 36, width: 28, height: 14 } },
        ]),
        createView("Side", [
          { name: "Side Panel", canvas: { top: 34, left: 38, width: 24, height: 20 } },
        ]),
      ],
    },
  },
  {
    id: "template-accessories",
    name: "Accessories",
    settings: {
      views: [
        createView("Front", [
          { name: "Primary Print", canvas: { top: 30, left: 30, width: 40, height: 32 } },
        ]),
        createView("Back", [
          { name: "Secondary Print", canvas: { top: 34, left: 34, width: 32, height: 24 } },
        ]),
      ],
    },
  },
];

const normalizeTemplate = (template, index = 0) => ({
  id: template?.id || createId(`template-${index}`),
  name: template?.name || `Template ${index + 1}`,
  settings: {
    views: Array.isArray(template?.settings?.views)
      ? template.settings.views.map(normalizeView)
      : [],
  },
});

const normalizeTemplates = (value) => {
  const templates = Array.isArray(value) ? value : [];
  return templates.length
    ? templates.map(normalizeTemplate)
    : createDefaultTemplates();
};

const fetchAddOnProduct = async (admin, productId, variantId) => {
  const normalizedProductId = toShopifyGid("Product", productId);
  const normalizedVariantId = toShopifyGid("ProductVariant", variantId);

  if (normalizedVariantId) {
    try {
      const variantResponse = await admin.graphql(
        `#graphql
        query getAddOnVariant($id: ID!) {
          node(id: $id) {
            ... on ProductVariant {
              id
              title
              displayName
              price
              image {
                url
              }
              product {
                id
                title
                featuredImage {
                  url
                }
              }
            }
          }
        }`,
        { variables: { id: normalizedVariantId }, tries: 3 },
      );
      const variantJson = await variantResponse.json();
      if (variantJson.errors?.length) {
        throw new Error(
          variantJson.errors.map((error) => error.message).join(", "),
        );
      }

      const variant = variantJson.data?.node;
      if (variant?.product) {
        return normalizeAddOnProduct({
          id: variant.product.id,
          title: variant.product.title,
          imageUrl: variant.image?.url || variant.product.featuredImage?.url,
          variant,
        });
      }
    } catch (error) {
      console.error("Could not fetch selected add-on variant", error);
    }
  }

  const productResponse = await admin.graphql(
    `#graphql
    query getAddOnProduct($id: ID!) {
      product(id: $id) {
        id
        title
        featuredImage {
          url
        }
        variants(first: 1) {
          nodes {
            id
            title
            displayName
            price
            image {
              url
            }
          }
        }
      }
    }`,
    { variables: { id: normalizedProductId }, tries: 3 },
  );
  const productJson = await productResponse.json();
  if (productJson.errors?.length) {
    throw new Error(productJson.errors.map((error) => error.message).join(", "));
  }

  const product = productJson.data?.product;
  return normalizeAddOnProduct({
    ...product,
    variant: product?.variants?.nodes?.[0],
  });
};

const hydrateAddOnProduct = async (admin, product) => {
  const normalizedProduct = normalizeAddOnProduct(product);
  if (!normalizedProduct) return null;

  if (
    normalizedProduct.variantId &&
    (!normalizedProduct.price ||
      !normalizedProduct.variantTitle ||
      !normalizedProduct.imageUrl)
  ) {
    return (
      (await fetchAddOnProduct(
        admin,
        normalizedProduct.id,
        normalizedProduct.variantId,
      )) || normalizedProduct
    );
  }

  return normalizedProduct;
};

const sanitizeTemplates = async (admin, templates) =>
  Promise.all(
    normalizeTemplates(templates).map(async (template) => ({
      ...template,
      settings: {
        views: await Promise.all(
          template.settings.views.map(async (view) => ({
            ...view,
            previewImage: view.previewImage || "",
            allowMultipleSelections: Boolean(view.allowMultipleSelections),
            optional: Boolean(view.optional),
            enableCollapsible: Boolean(view.enableCollapsible),
            collapsibleHeading: view.collapsibleHeading || view.name,
            positions: await Promise.all(
              view.positions.map(async (position) => ({
                ...position,
                previewImage: position.previewImage || "",
                addOnProduct: await hydrateAddOnProduct(
                  admin,
                  position.addOnProduct,
                ),
              })),
            ),
          })),
        ),
      },
    })),
  );

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const response = await admin.graphql(
    `#graphql
    query getProductTemplates {
      currentAppInstallation {
        id
        productTemplates: metafield(namespace: "custom", key: "product_templates") {
          jsonValue
        }
      }
    }`,
    { tries: 3 },
  );
  const responseJson = await response.json();

  return {
    ownerId: responseJson.data.currentAppInstallation.id,
    templates: normalizeTemplates(
      responseJson.data.currentAppInstallation.productTemplates?.jsonValue,
    ),
  };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("intent") === "resolveAddOnProduct") {
    try {
      const addOnProduct = await fetchAddOnProduct(
        admin,
        formData.get("productId"),
        formData.get("variantId"),
      );

      if (!addOnProduct) {
        return Response.json(
          { error: "Could not load selected add-on product" },
          { status: 404 },
        );
      }

      return Response.json({ addOnProduct });
    } catch (error) {
      return Response.json(
        { error: error.message || "Could not load selected add-on product" },
        { status: 500 },
      );
    }
  }

  const templates = await sanitizeTemplates(
    admin,
    JSON.parse(formData.get("templates")),
  );
  const ownerId = formData.get("ownerId");
  const response = await admin.graphql(
    `#graphql
    mutation saveProductTemplates($metafields: [MetafieldsSetInput!]!) {
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
            ownerId,
            namespace: TEMPLATE_NAMESPACE,
            key: TEMPLATE_KEY,
            type: "json",
            value: JSON.stringify(templates),
          },
        ],
      },
      tries: 3,
    },
  );
  const responseJson = await response.json();
  return Response.json({ ...responseJson, templates });
};

export default function ProductTemplates() {
  const { ownerId, templates: loadedTemplates } = useLoaderData();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const pendingTemplates = useRef(null);
  const [templates, setTemplates] = useState(loadedTemplates);
  const [savedTemplates, setSavedTemplates] = useState(loadedTemplates);
  const [activeTemplateId, setActiveTemplateId] = useState(
    loadedTemplates[0]?.id || "",
  );
  const [collapsedViewIds, setCollapsedViewIds] = useState(() => new Set());
  const [uploadingPreviewImage, setUploadingPreviewImage] = useState(false);

  const activeTemplate =
    templates.find((template) => template.id === activeTemplateId) ||
    templates[0];
  const activeTemplateIndex = templates.findIndex(
    (template) => template.id === activeTemplate?.id,
  );
  const isSaving = fetcher.state !== "idle";
  const hasUnsavedChanges =
    JSON.stringify(templates) !== JSON.stringify(savedTemplates);

  useEffect(() => {
    if (fetcher.data?.data?.metafieldsSet?.metafields?.[0]?.id) {
      const nextTemplates = fetcher.data.templates || pendingTemplates.current;
      if (nextTemplates) {
        setTemplates(nextTemplates);
        setSavedTemplates(nextTemplates);
      }
      pendingTemplates.current = null;
      shopify.toast.show("Product templates saved");
    } else if (fetcher.data?.data?.metafieldsSet?.userErrors?.length > 0) {
      pendingTemplates.current = null;
      shopify.toast.show(
        `Error saving: ${fetcher.data.data.metafieldsSet.userErrors[0].message}`,
      );
    }
  }, [fetcher.data, shopify]);

  const updateTemplate = (templateIdx, updater) => {
    setTemplates((currentTemplates) =>
      currentTemplates.map((template, index) =>
        index === templateIdx ? updater(template) : template,
      ),
    );
  };

  const handleSave = () => {
    pendingTemplates.current = templates;
    fetcher.submit(
      { ownerId, templates: JSON.stringify(templates) },
      { method: "POST" },
    );
  };

  const handleCancel = () => {
    setTemplates(savedTemplates);
  };

  const addTemplate = () => {
    const template = {
      id: createId("template"),
      name: "New Template",
      settings: { views: [createView("Front")] },
    };
    setTemplates((currentTemplates) => [...currentTemplates, template]);
    setActiveTemplateId(template.id);
  };

  const removeTemplate = (templateIdx) => {
    if (templates.length === 1) return;
    const nextTemplates = templates.filter((_, index) => index !== templateIdx);
    setTemplates(nextTemplates);
    setActiveTemplateId(nextTemplates[0]?.id || "");
  };

  const addView = () => {
    const view = createView("New side");
    updateTemplate(activeTemplateIndex, (template) => ({
      ...template,
      settings: {
        views: [...template.settings.views, view],
      },
    }));
  };

  const removeView = (viewIdx) => {
    updateTemplate(activeTemplateIndex, (template) => ({
      ...template,
      settings: {
        views: template.settings.views.filter((_, index) => index !== viewIdx),
      },
    }));
  };

  const updateView = (viewIdx, updater) => {
    updateTemplate(activeTemplateIndex, (template) => ({
      ...template,
      settings: {
        views: template.settings.views.map((view, index) =>
          index === viewIdx ? updater(view) : view,
        ),
      },
    }));
  };

  const updatePosition = (viewIdx, positionIdx, updater) => {
    updateView(viewIdx, (view) => ({
      ...view,
      positions: view.positions.map((position, index) =>
        index === positionIdx ? updater(position) : position,
      ),
    }));
  };

  const addPosition = (viewIdx) => {
    updateView(viewIdx, (view) => ({
      ...view,
      positions: [
        ...view.positions,
        createPosition(`Print area ${view.positions.length + 1}`),
      ],
    }));
  };

  const removePosition = (viewIdx, positionIdx) => {
    updateView(viewIdx, (view) => ({
      ...view,
      positions: view.positions.filter((_, index) => index !== positionIdx),
    }));
  };

  const updateViewPreviewImage = (viewIdx, previewImage) => {
    updateView(viewIdx, (view) => ({
      ...view,
      previewImage,
    }));
  };

  const updatePositionPreviewImage = (viewIdx, positionIdx, previewImage) => {
    updatePosition(viewIdx, positionIdx, (position) => ({
      ...position,
      previewImage,
    }));
  };

  const uploadPreviewImage = async (event, onUpload) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) return;

    setUploadingPreviewImage(true);

    try {
      const formData = new FormData();
      formData.append("image", file);
      formData.append("fileName", `template-preview-${Date.now()}`);

      const response = await fetch("/api/cloudinary", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (!response.ok || !result.imageUrl) {
        throw new Error(result.error || "Image upload failed");
      }

      onUpload(result.imageUrl);
      shopify.toast.show("Preview image uploaded");
    } catch (error) {
      console.error("Template preview upload failed", error);
      shopify.toast.show(error.message || "Image upload failed");
    } finally {
      setUploadingPreviewImage(false);
    }
  };

  const renderPositionOverlay = (position) => (
    <div
      title={position.name}
      style={{
        position: "absolute",
        top: `${position.canvas.top}%`,
        left: `${position.canvas.left}%`,
        width: `${position.canvas.width}%`,
        height: `${position.canvas.height}%`,
        border: "2px dashed #008060",
        backgroundColor: "rgba(0, 128, 96, 0.12)",
        color: "#202223",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "10px",
        fontWeight: 600,
        lineHeight: "12px",
        overflow: "hidden",
        padding: "2px",
        pointerEvents: "none",
        textAlign: "center",
        wordBreak: "break-word",
      }}
    >
      {position.name}
    </div>
  );

  const renderImagePreview = (imageUrl, altText, positions) => (
    <div
      style={{
        width: "100%",
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
        }}
      />
      {positions.map((position) => renderPositionOverlay(position))}
    </div>
  );

  const renderEmptyPreviewState = () => (
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
      <s-text color="subdued">
        Add a reference image to position print areas.
      </s-text>
    </div>
  );

  const renderPreviewImageActions = ({
    hasImage,
    onUpload,
    onRemove,
    addLabel = "Add File",
  }) => (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "8px",
        justifyContent: "flex-end",
      }}
    >
      <s-button
        disabled={uploadingPreviewImage}
        {...(uploadingPreviewImage ? { loading: true } : {})}
      >
        <label
          style={{
            cursor: uploadingPreviewImage ? "default" : "pointer",
          }}
        >
          {hasImage ? "Change File" : addLabel}
          <input
            type="file"
            accept="image/*"
            disabled={uploadingPreviewImage}
            onChange={(event) => uploadPreviewImage(event, onUpload)}
            style={{ display: "none" }}
          />
        </label>
      </s-button>
      {hasImage && (
        <s-button variant="tertiary" tone="critical" onClick={onRemove}>
          Remove
        </s-button>
      )}
    </div>
  );

  const renderPreviewImageArea = (view, viewIdx) => (
    <div
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: "8px",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        backgroundColor: "#fff",
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
          flexWrap: "wrap",
        }}
      >
        <s-stack direction="block" gap="none">
          <s-text type="strong">{view.name} preview image</s-text>
          <s-text color="subdued">
            Reference only for setting template positions.
          </s-text>
        </s-stack>
        {renderPreviewImageActions({
          hasImage: Boolean(view.previewImage),
          onUpload: (imageUrl) => updateViewPreviewImage(viewIdx, imageUrl),
          onRemove: () => updateViewPreviewImage(viewIdx, ""),
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
        {view.previewImage
          ? renderImagePreview(
              view.previewImage,
              `${activeTemplate.name} ${view.name} preview`,
              view.positions,
            )
          : renderEmptyPreviewState()}
      </div>
    </div>
  );

  const renderPositionPreviewImageArea = (view, viewIdx, position, positionIdx) => (
    <div
      style={{
        border: "1px solid #e3e3e3",
        borderRadius: "8px",
        backgroundColor: "#fafafa",
        padding: "12px",
      }}
    >
      <s-stack direction="block" gap="small">
        <s-stack direction="inline" alignItems="center" justifyContent="space-between" gap="base">
          <s-stack direction="block" gap="none">
            <s-text type="strong">{position.name} position image</s-text>
            <s-text color="subdued">
              Optional reference image for this print area.
            </s-text>
          </s-stack>
          {renderPreviewImageActions({
            hasImage: Boolean(position.previewImage),
            onUpload: (imageUrl) =>
              updatePositionPreviewImage(viewIdx, positionIdx, imageUrl),
            onRemove: () => updatePositionPreviewImage(viewIdx, positionIdx, ""),
          })}
        </s-stack>

        {position.previewImage &&
          renderImagePreview(
            position.previewImage,
            `${activeTemplate.name} ${view.name} ${position.name} preview`,
            [position],
          )}
      </s-stack>
    </div>
  );

  const resolveAddOnProduct = async (selectedProduct, selectedVariant) => {
    const formData = new FormData();
    formData.append("intent", "resolveAddOnProduct");
    formData.append("productId", selectedProduct.id);

    if (selectedVariant?.id) {
      formData.append("variantId", selectedVariant.id);
    }

    const idToken = await shopify.idToken();
    const response = await fetch(window.location.href, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    const responseText = await response.text();
    const result = responseText ? JSON.parse(responseText) : {};

    if (!response.ok || !result.addOnProduct) {
      throw new Error(result.error || "Could not load add-on product details");
    }

    return result.addOnProduct;
  };

  const selectPositionAddOnProduct = async (viewIdx, positionIdx) => {
    const position =
      activeTemplate?.settings.views[viewIdx]?.positions?.[positionIdx];
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

    const selectedVariant = getFirstVariant(selectedProduct.variants);
    const pickerProduct = normalizeAddOnProduct({
      ...selectedProduct,
      variant: selectedVariant,
    });

    try {
      const addOnProduct = await resolveAddOnProduct(
        selectedProduct,
        selectedVariant,
      );
      updatePosition(viewIdx, positionIdx, (position) => ({
        ...position,
        addOnProduct,
      }));
    } catch (error) {
      console.error("Could not resolve add-on product price", error);
      updatePosition(viewIdx, positionIdx, (position) => ({
        ...position,
        addOnProduct: pickerProduct,
      }));
      if (pickerProduct?.price) {
        shopify.toast.show("Add-on product selected");
      } else {
        shopify.toast.show("Selected product, but could not load its price.");
      }
    }
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

  return (
    <s-page heading="Product Templates">
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
            Save Templates
          </s-button>
        </>
      )}

      <s-section>
        <s-stack direction="block" gap="base">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 280px) minmax(0, 1fr)",
              gap: "16px",
              alignItems: "start",
            }}
          >
            <div
              style={{
                border: "1px solid #e3e3e3",
                borderRadius: "8px",
                overflow: "hidden",
                backgroundColor: "#fff",
              }}
            >
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setActiveTemplateId(template.id)}
                  style={{
                    width: "100%",
                    border: "0",
                    borderBottom: "1px solid #e3e3e3",
                    backgroundColor:
                      template.id === activeTemplate?.id ? "#eef6f3" : "#fff",
                    color: "#202223",
                    cursor: "pointer",
                    fontWeight: template.id === activeTemplate?.id ? 700 : 500,
                    padding: "12px 14px",
                    textAlign: "left",
                  }}
                >
                  {template.name}
                </button>
              ))}
              <div style={{ padding: "12px" }}>
                <s-button variant="primary" onClick={addTemplate}>
                  Add Template
                </s-button>
              </div>
            </div>

            {activeTemplate && (
              <s-stack direction="block" gap="base">
                <div
                  style={{
                    border: "1px solid #e3e3e3",
                    borderRadius: "8px",
                    padding: "16px",
                    backgroundColor: "#fafafa",
                    display: "flex",
                    gap: "12px",
                    alignItems: "end",
                  }}
                >
                  <div style={{ flexGrow: 1 }}>
                    <s-text-field
                      label="Template name"
                      value={activeTemplate.name}
                      onChange={(event) => {
                        const name = event.currentTarget.value;

                        updateTemplate(activeTemplateIndex, (template) => ({
                          ...template,
                          name,
                        }));
                      }}
                      autocomplete="off"
                    />
                  </div>
                  <s-button
                    tone="critical"
                    disabled={templates.length === 1}
                    onClick={() => removeTemplate(activeTemplateIndex)}
                  >
                    Remove Template
                  </s-button>
                </div>

                {activeTemplate.settings.views.map((view, viewIdx) => {
                  const isCollapsed = collapsedViewIds.has(view.id);

                  return (
                    <div
                      key={view.id}
                      style={{
                        border: "1px solid #d4d4d8",
                        borderRadius: "8px",
                        backgroundColor: isCollapsed ? "#fff" : "#f6f6f7",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          padding: "16px 18px 16px 14px",
                          borderBottom: isCollapsed
                            ? "none"
                            : "1px solid #d4d4d8",
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
                            onChange={(event) => {
                              const name = event.currentTarget.value;

                              updateView(viewIdx, (currentView) => ({
                                ...currentView,
                                name,
                                collapsibleHeading:
                                  currentView.collapsibleHeading || name,
                              }));
                            }}
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
                            disabled={activeTemplate.settings.views.length === 1}
                            onClick={() => removeView(viewIdx)}
                          >
                            Remove Side
                          </s-button>
                        </s-stack>
                      </div>

                      {!isCollapsed && (
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
                            <div
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
                              }}
                            >
                              <input
                                id={`${view.id}-allow-multiple`}
                                type="checkbox"
                                checked={view.allowMultipleSelections}
                                onChange={(event) => {
                                  const allowMultipleSelections =
                                    event.currentTarget.checked;

                                  updateView(viewIdx, (currentView) => ({
                                    ...currentView,
                                    allowMultipleSelections,
                                  }));
                                }}
                                style={{ marginTop: "3px" }}
                              />
                              <span>
                                <label
                                  htmlFor={`${view.id}-allow-multiple`}
                                  style={{
                                    display: "block",
                                    fontWeight: 600,
                                    cursor: "pointer",
                                  }}
                                >
                                  Multi-option selector
                                </label>
                                <span style={{ color: "#6d7175" }}>
                                  Allow customers to select more than one option
                                  in this block.
                                </span>
                              </span>
                            </div>

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
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: "10px",
                                }}
                              >
                                <input
                                  id={`${view.id}-enable-collapsible`}
                                  type="checkbox"
                                  checked={view.enableCollapsible}
                                  onChange={(event) => {
                                    const enableCollapsible =
                                      event.currentTarget.checked;

                                    updateView(viewIdx, (currentView) => ({
                                      ...currentView,
                                      enableCollapsible,
                                    }));
                                  }}
                                  style={{ marginTop: "3px" }}
                                />
                                <span>
                                  <label
                                    htmlFor={`${view.id}-enable-collapsible`}
                                    style={{
                                      display: "block",
                                      fontWeight: 600,
                                      cursor: "pointer",
                                    }}
                                  >
                                    Collapsible block
                                  </label>
                                  <span style={{ color: "#6d7175" }}>
                                    Use this side inside a collapsible frontend
                                    tab.
                                  </span>
                                </span>
                              </div>
                              <s-text-field
                                label="Collapsible heading"
                                value={view.collapsibleHeading}
                                onChange={(event) => {
                                  const collapsibleHeading =
                                    event.currentTarget.value;

                                  updateView(viewIdx, (currentView) => ({
                                    ...currentView,
                                    collapsibleHeading,
                                  }));
                                }}
                                autocomplete="off"
                              />
                            </div>
                          </div>

                          {renderPreviewImageArea(view, viewIdx)}

                          <s-stack direction="block" gap="base">
                            {view.positions.map((position, positionIdx) => (
                              <div
                                key={position.id}
                                style={{
                                  border: "1px solid #e3e3e3",
                                  borderRadius: "8px",
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
                                      onChange={(event) => {
                                        const name = event.currentTarget.value;

                                        updatePosition(
                                          viewIdx,
                                          positionIdx,
                                          (currentPosition) => ({
                                            ...currentPosition,
                                            name,
                                          }),
                                        );
                                      }}
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
                                      display: "grid",
                                      gridTemplateColumns:
                                        "repeat(auto-fit, minmax(120px, 1fr))",
                                      gap: "10px",
                                    }}
                                  >
                                    {["top", "left", "width", "height"].map(
                                      (field) => (
                                        <s-text-field
                                          key={field}
                                          label={
                                            field.charAt(0).toUpperCase() +
                                            field.slice(1)
                                          }
                                          type="number"
                                          value={String(position.canvas[field])}
                                          onChange={(event) => {
                                            const value = parseFloat(
                                              event.currentTarget.value,
                                            );
                                            if (Number.isNaN(value)) return;

                                            updatePosition(
                                              viewIdx,
                                              positionIdx,
                                              (currentPosition) => ({
                                                ...currentPosition,
                                                canvas: {
                                                  ...currentPosition.canvas,
                                                  [field]: value,
                                                },
                                              }),
                                            );
                                          }}
                                        />
                                      ),
                                    )}
                                  </div>

                                  {renderPositionPreviewImageArea(
                                    view,
                                    viewIdx,
                                    position,
                                    positionIdx,
                                  )}

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
                                            <s-stack
                                              direction="block"
                                              gap="none"
                                            >
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
                                                updatePosition(
                                                  viewIdx,
                                                  positionIdx,
                                                  (currentPosition) => ({
                                                    ...currentPosition,
                                                    addOnProduct: null,
                                                  }),
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
            )}
          </div>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
