const cloudinary = require("cloudinary").v2;
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "cooktok/videos",
    resource_type: "video",
    allowed_formats: ["mp4", "mov", "webm"],
  },
});

// 10-minute cooking videos can be large; cap at 200MB per the spec's upload limits.
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
});

const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "cooktok/avatars",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
    transformation: [{ width: 256, height: 256, crop: "fill", gravity: "face" }],
  },
});
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

module.exports = { cloudinary, upload, uploadAvatar };
