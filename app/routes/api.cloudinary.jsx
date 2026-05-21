
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { data } from "react-router";
import { v2 as cloudinary } from 'cloudinary';


export const loader = async ({ request, response }) => {
    return data({ message: "hello" });
};


export const action = async ({ request }) => {
    const reqData = await request.json();

    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
    });

    
    const uploadOptions = {
        public_id: `${reqData.fileName}`,
        // "auto" is the magic setting—it handles images, PDFs, and videos automatically
        resource_type: "auto", 
        // Optional: keeps your folder tidy
        folder: "shopify_custom_designs" 
    };

    try {
        const uploadResult = await cloudinary.uploader.upload(reqData.image, uploadOptions);
        return data({ message: uploadResult });
    } catch (error) {
        console.error("Upload Error:", error);
        return data({ error: "Upload failed" }, { status: 500 });
    }
};
