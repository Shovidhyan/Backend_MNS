require("dotenv").config();
const express = require("express");
const sql = require("mssql");
const cors = require("cors");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// ========================================================
// 🧩 SQL CONFIG
// ========================================================
const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  options: {
    encrypt: process.env.DB_ENCRYPT === "true",
    trustServerCertificate: process.env.DB_TRUST_CERT === "true",
  },
};

// ========================================================
// 🧩 CONNECT TO SQL
// ========================================================
sql.connect(dbConfig)
  .then(() => console.log("✅ Connected to SQL Server"))
  .catch((err) => console.error("❌ SQL Connection Error:", err));

// ========================================================
// 🧩 MULTER (Store Files in Memory Instead of Disk)
// ========================================================
const storage = multer.memoryStorage();
const upload = multer({ storage });

// ========================================================
// 🏁 TEST ROUTE
// ========================================================
app.get("/", (req, res) => {
  res.send("✅ Server running and connected to SQL Server with image VARBINARY storage!");
});

// ========================================================
// 👤 LOGIN ENDPOINT
// ========================================================
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const request = new sql.Request();
    request.input("username", sql.NVarChar, username);
    const result = await request.query("SELECT * FROM tbl_Users WHERE Username = @username");

    if (!result.recordset.length)
      return res.status(401).json({ error: "Invalid credentials" });

    const user = result.recordset[0];
    const valid = password === user.PasswordHash; // ⚠️ Use bcrypt in production

    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    res.json({
      message: "✅ Login successful",
      userId: user.UserID,
      username: user.Username,
    });
  } catch (err) {
    console.error("❌ Login Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================
// 🏗️ PROJECTS CRUD
// ========================================================
app.get("/projects", async (req, res) => {
  try {
    const result = await new sql.Request().query(`
      SELECT ProjectID, ClientName, Description, EndUser, Duration, Status, CreatedAt, UpdatedAt
      FROM tbl_Projects
      ORDER BY ProjectID DESC
    `);
    res.json(result.recordset);
  } catch (err) {
    console.error("❌ Fetch Projects Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/projects", async (req, res) => {
  const { ProjectID, ClientName, Description, EndUser, Duration, Status } = req.body;

  try {
    const request = new sql.Request();
    request.input("ClientName", sql.NVarChar, ClientName);
    request.input("Description", sql.NVarChar, Description);
    request.input("EndUser", sql.NVarChar, EndUser);
    request.input("Duration", sql.NVarChar, Duration);
    request.input("Status", sql.NVarChar, Status);

    if (ProjectID && ProjectID !== 0) {
      request.input("ProjectID", sql.Int, ProjectID);
      await request.query(`
        UPDATE tbl_Projects
        SET ClientName=@ClientName,
            Description=@Description,
            EndUser=@EndUser,
            Duration=@Duration,
            Status=@Status,
            UpdatedAt=GETDATE()
        WHERE ProjectID=@ProjectID
      `);
      res.json({ message: "✅ Project updated successfully" });
    } else {
      await request.query(`
        INSERT INTO tbl_Projects (ClientName, Description, EndUser, Duration, Status, CreatedAt, UpdatedAt)
        VALUES (@ClientName, @Description, @EndUser, @Duration, @Status, GETDATE(), GETDATE())
      `);
      res.json({ message: "✅ Project added successfully" });
    }
  } catch (err) {
    console.error("❌ Project Save Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/projects/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const request = new sql.Request();
    request.input("ProjectID", sql.Int, id);
    await request.query("DELETE FROM tbl_Gallery_Images WHERE ProjectID=@ProjectID");
    await request.query("DELETE FROM tbl_Projects WHERE ProjectID=@ProjectID");
    res.json({ message: "🗑️ Project and related images deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Project Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================
// 🖼️ GALLERY ROUTES (VARBINARY STORAGE)
// ========================================================
app.post("/projects/:projectId/gallery", upload.array("images"), async (req, res) => {
  const { projectId } = req.params;
  const files = req.files;

  if (!files || files.length === 0)
    return res.status(400).json({ error: "⚠️ No images uploaded" });

  try {
    const pool = await sql.connect(dbConfig);
    for (const file of files) {
      await pool.request()
        .input("ProjectID", sql.Int, Number(projectId))
        .input("ImageData", sql.VarBinary(sql.MAX), file.buffer)
        .query(`
          INSERT INTO tbl_Gallery_Images (ProjectID, ImageData, UploadedAt)
          VALUES (@ProjectID, @ImageData, GETDATE())
        `);
    }
    res.json({ message: "✅ Images uploaded successfully" });
  } catch (err) {
    console.error("❌ Gallery Upload Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Fetch all gallery images for preview
app.get("/gallery", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);
    const result = await pool.request().query(`
      SELECT g.GalleryID, g.ProjectID, p.ClientName, g.ImageData
      FROM tbl_Gallery_Images g
      JOIN tbl_Projects p ON g.ProjectID = p.ProjectID
      ORDER BY g.GalleryID DESC
    `);

    const galleryWithBase64 = result.recordset.map((item) => ({
      GalleryID: item.GalleryID,
      ProjectID: item.ProjectID,
      ClientName: item.ClientName,
      ImageBase64: item.ImageData
        ? `data:image/jpeg;base64,${Buffer.from(item.ImageData).toString("base64")}`
        : null,
    }));

    res.json(galleryWithBase64);
  } catch (err) {
    console.error("❌ Fetch Gallery Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// Delete single gallery image
app.delete("/gallery/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const request = new sql.Request();
    request.input("GalleryID", sql.Int, id);
    const result = await request.query("DELETE FROM tbl_Gallery_Images WHERE GalleryID=@GalleryID");

    if (result.rowsAffected[0] === 0)
      return res.status(404).json({ error: "Image not found" });

    res.json({ message: "🗑️ Gallery image deleted successfully" });
  } catch (err) {
    console.error("❌ Delete Gallery Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================
// 🧩 PROJECTS WITH GALLERY (Combined for React)
// ========================================================
app.get("/projects-with-gallery", async (req, res) => {
  try {
    const pool = await sql.connect(dbConfig);

    const projectsResult = await pool.request().query(`
      SELECT ProjectID, ClientName, Description, EndUser, Duration, Status
      FROM tbl_Projects
      ORDER BY ProjectID DESC
    `);

    const projects = projectsResult.recordset;

    const galleryResult = await pool.request().query(`
      SELECT GalleryID, ProjectID, ImageData
      FROM tbl_Gallery_Images
    `);

    const galleryImages = galleryResult.recordset.map((img) => ({
      GalleryID: img.GalleryID,
      ProjectID: img.ProjectID,
      ImageBase64: img.ImageData
        ? `data:image/jpeg;base64,${Buffer.from(img.ImageData).toString("base64")}`
        : null,
    }));

    const combined = projects.map((proj) => ({
      ...proj,
      gallery: galleryImages.filter((g) => g.ProjectID === proj.ProjectID),
    }));

    res.json(combined);
  } catch (err) {
    console.error("❌ Fetch Projects with Gallery Error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================================================
// 🚀 SERVER START
// ========================================================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Server running at http://localhost:${PORT}`)
);
