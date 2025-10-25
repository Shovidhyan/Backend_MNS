require("dotenv").config();
const express = require("express");
const sql = require("mssql");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ========================================================
// 🔧 SQL CONFIG
// ========================================================
const dbConfig = {
  user: process.env.DB_USER || "SA",
  password: process.env.DB_PASSWORD || "YourStrongPassword123",
  server: process.env.DB_SERVER || "localhost",
  database: process.env.DB_NAME || "ProjectDB",
  options: {
    encrypt: true,
    trustServerCertificate: true,
  },
};

// ========================================================
// 🧩 CONNECT TO SQL
// ========================================================
sql.connect(dbConfig)
  .then(() => console.log("✅ Connected to SQL Server"))
  .catch((err) => console.error("❌ SQL Connection Error:", err));

// ========================================================
// 📦 MULTER CONFIG
// ========================================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "uploads", "gallery");
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + "_" + file.originalname.replace(/\s+/g, "_");
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

const cleanupFiles = (files) => {
  if (files && Array.isArray(files)) {
    files.forEach((file) => {
      const filePath = path.join(file.destination, file.filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Cleaned up file: ${filePath}`);
      }
    });
  }
};

// ========================================================
// 🧱 ROUTES
// ========================================================

// 1️⃣ Get all projects
app.get("/projects", async (req, res) => {
  try {
    const result = await new sql.Request().query(`
      SELECT ProjectID, ClientName FROM tbl_Projects ORDER BY ProjectID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Fetch Projects Error:", err);
    res.status(500).json({ error: "Server error fetching projects." });
  }
});

// 2️⃣ Upload gallery images
app.post("/projects/:projectId/gallery", (req, res, next) => {
  upload.array("images")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      cleanupFiles(req.files);
      return res.status(400).json({ error: "File upload failed: " + err.message });
    } else if (err) {
      cleanupFiles(req.files);
      return res.status(500).json({ error: "An unknown upload error occurred." });
    }
    next();
  });
}, async (req, res) => {
  const { projectId } = req.params;
  const files = req.files;

  if (!files?.length) return res.status(400).json({ error: "⚠️ No images received." });

  try {
    const pool = await sql.connect(dbConfig);
    const projectCheck = await pool.request()
      .input("ProjectID", sql.Int, Number(projectId))
      .query("SELECT ProjectID FROM tbl_Projects WHERE ProjectID = @ProjectID");

    if (!projectCheck.recordset.length) {
      cleanupFiles(files);
      return res.status(404).json({ error: `Project ID ${projectId} not found.` });
    }

    for (const file of files) {
      const imagePath = path.join("uploads", "gallery", file.filename);
      await pool.request()
        .input("ProjectID", sql.Int, Number(projectId))
        .input("ImagePath", sql.NVarChar(sql.MAX), imagePath)
        .query(`
          INSERT INTO tbl_Gallery_Images (ProjectID, ImagePath, UploadedAt)
          VALUES (@ProjectID, @ImagePath, GETDATE())
        `);
    }

    res.json({ message: "✅ Images uploaded and saved successfully." });
  } catch (err) {
    console.error("❌ Gallery DB Insertion Error:", err);
    cleanupFiles(files);
    res.status(500).json({ error: "Server error during database insertion." });
  }
});

// 3️⃣ Get all gallery images
app.get("/gallery", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
      SELECT g.GalleryID, g.ProjectID, g.ImagePath, p.ClientName
      FROM tbl_Gallery_Images g
      JOIN tbl_Projects p ON g.ProjectID = p.ProjectID
      ORDER BY g.GalleryID DESC
    `);

    const gallery = result.recordset.map((item) => ({
      GalleryID: item.GalleryID,
      ProjectID: item.ProjectID,
      ClientName: item.ClientName,
      ImagePath: item.ImagePath,
    }));

    res.json(gallery);
  } catch (err) {
    console.error("❌ Fetch Gallery Error:", err);
    res.status(500).json({ error: "Server error fetching gallery." });
  }
});

// 4️⃣ Delete gallery image
app.delete("/gallery/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request()
      .input("GalleryID", sql.Int, id)
      .query("SELECT ImagePath FROM tbl_Gallery_Images WHERE GalleryID=@GalleryID");

    if (!result.recordset.length) return res.status(404).json({ error: "Image not found." });

    const imagePathRecord = result.recordset[0].ImagePath;
    await pool.request()
      .input("GalleryID", sql.Int, id)
      .query("DELETE FROM tbl_Gallery_Images WHERE GalleryID=@GalleryID");

    const filePath = path.join(__dirname, imagePathRecord);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Deleted file: ${filePath}`);
    }

    res.json({ message: "🗑️ Gallery image deleted successfully." });
  } catch (err) {
    console.error("❌ Delete Gallery Error:", err);
    res.status(500).json({ error: "Server error during deletion." });
  }
});

// 5️⃣ ✨ EDIT (UPDATE) Gallery Image
app.put("/gallery/:id", (req, res, next) => {
  upload.single("image")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      cleanupFiles([req.file]);
      return res.status(400).json({ error: "File upload failed: " + err.message });
    } else if (err) {
      cleanupFiles([req.file]);
      return res.status(500).json({ error: "An unknown upload error occurred." });
    }
    next();
  });
}, async (req, res) => {
  const { id } = req.params;
  const { projectId } = req.body;
  const file = req.file;

  try {
    const pool = await sql.connect(dbConfig);
    const oldImage = await pool.request()
      .input("GalleryID", sql.Int, id)
      .query("SELECT ImagePath FROM tbl_Gallery_Images WHERE GalleryID=@GalleryID");

    if (!oldImage.recordset.length) {
      if (file) cleanupFiles([file]);
      return res.status(404).json({ error: "Image not found." });
    }

    const oldPath = path.join(__dirname, oldImage.recordset[0].ImagePath);
    const newPath = file ? path.join("uploads", "gallery", file.filename) : null;

    // Update the record
    let query = `UPDATE tbl_Gallery_Images SET `;
    if (projectId) query += `ProjectID = @ProjectID, `;
    if (newPath) query += `ImagePath = @ImagePath, `;
    query += `UploadedAt = GETDATE() WHERE GalleryID = @GalleryID`;

    const request = pool.request().input("GalleryID", sql.Int, id);
    if (projectId) request.input("ProjectID", sql.Int, Number(projectId));
    if (newPath) request.input("ImagePath", sql.NVarChar(sql.MAX), newPath);

    await request.query(query);

    if (newPath && fs.existsSync(oldPath)) {
      fs.unlinkSync(oldPath);
      console.log(`🗑️ Old image replaced: ${oldPath}`);
    }

    res.json({ message: "✅ Gallery image updated successfully." });
  } catch (err) {
    console.error("❌ Edit Gallery Error:", err);
    if (file) cleanupFiles([file]);
    res.status(500).json({ error: "Server error during update." });
  }
});

// ========================================================
// 🚀 START SERVER
// ========================================================
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
