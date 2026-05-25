import { Buffer } from "node:buffer";
import process from "node:process";
import { v2 as cloudinary } from "cloudinary";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, ngrok-skip-browser-warning",
};

const jsonResponse = (body, init = {}) =>
  Response.json(body, {
    ...init,
    headers: {
      ...corsHeaders,
      ...(init.headers || {}),
    },
  });

const getUploadPayload = async (request) => {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("image");

    if (!file || typeof file === "string") {
      return {};
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const image = `data:${file.type || "application/octet-stream"};base64,${buffer.toString("base64")}`;

    return {
      image,
      fileName:
        formData.get("fileName") ||
        file.name?.replace(/\.[^/.]+$/, "") ||
        `customized-product-${Date.now()}`,
    };
  }

  return request.json();
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return jsonResponse({ message: "Cloudinary upload endpoint is ready" });
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const { image, fileName } = await getUploadPayload(request);

  if (!image) {
    return jsonResponse({ error: "Missing image" }, { status: 400 });
  }

  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    return jsonResponse(
      { error: "Cloudinary environment variables are not configured" },
      { status: 500 },
    );
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });

  try {
    const uploadResult = await cloudinary.uploader.upload(image, {
      public_id: fileName || `customized-product-${Date.now()}`,
      resource_type: "auto",
      folder: "shopify_custom_designs",
    });

    return jsonResponse({
      imageUrl: uploadResult.secure_url,
      message: uploadResult,
    });
  } catch (error) {
    console.error("Upload Error:", error);
    return jsonResponse({ error: "Upload failed" }, { status: 500 });
  }
};
