require("dotenv").config();
const express = require("express");
const sql = require("mssql");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// const projectRoutes = require("./projectRoutes"); // REMOVED: Integrating logic directly

const app = express();
const PORT = process.env.PORT || 5000;

// ========================================================
// 🌐 MIDDLEWARE
// ========================================================
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Static folder for uploaded files
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
// The connection will be pooled and used across all route handlers
sql.connect(dbConfig)
    .then(() => console.log("✅ Connected to SQL Server"))
    .catch((err) => console.error("❌ SQL Connection Error:", err));

// ========================================================
// 📦 MULTER CONFIG
// ========================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, "uploads", "gallery");
        // Ensure the directory exists
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
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// Helper: cleanup uploaded files if needed
const cleanupFiles = (files) => {
    if (files && Array.isArray(files)) {
        files.forEach((file) => {
            // Note: file.path is more reliable if the full path is available from multer,
            // but for safety, we construct it using file.destination and file.filename.
            const filePath = path.join(file.destination, file.filename);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Cleaned up file: ${filePath}`);
            }
        });
    } else if (files && files.path) { // Handle single file uploads
        if (fs.existsSync(files.path)) {
            fs.unlinkSync(files.path);
            console.log(`🗑️ Cleaned up single file: ${files.path}`);
        }
    }
};

// ========================================================
// 🧱 AUTH & DEFAULT ROUTES
// ========================================================

// ✅ Default route (Home)
app.get("/", (req, res) => {
    res.send(`
    <div style="font-family:sans-serif;text-align:center;margin-top:50px;color:#333;">
      <h1 style="font-size:2.5em;"> Shovi, your API is running under safer hands!!! 💪</h1>
      <p style="font-size:1.1em;color:#555;margin-top:10px;">
        Everything is secure, smooth, and ready to roll.
      </p>
    </div>
  `);
});

// 🔒 Login Route
// NOTE: This route should use bcrypt for password hashing in production!
app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required" });
    }

    try {
        const request = new sql.Request();
        request.input("username", sql.NVarChar, username);

        // Query the user by username (uses parameterized query to prevent SQL injection)
        const result = await request.query("SELECT * FROM tbl_Users WHERE Username = @username");

        if (!result.recordset.length) {
            // Generic error message for security
            return res.status(401).json({ error: "Invalid credentials" });
        }

        const user = result.recordset[0];

        // ⚠️ CRITICAL SECURITY FLAW: Direct password comparison. 
        // In production, use await bcrypt.compare(password, user.PasswordHash)
        const valid = password === user.PasswordHash;

        if (!valid) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Success response
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
// 🏗️ PROJECT CRUD ROUTES (Merged from projectRoutes.js)
// ========================================================

// 1️⃣ Get all projects
// GET /projects
app.get("/projects", async (req, res) => {
    try {
        const result = await new sql.Request().query(`
            SELECT 
                ProjectID, ClientName, Description, EndUser, 
                Duration, Status, CreatedAt, UpdatedAt
            FROM tbl_Projects
            ORDER BY ProjectID DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error("❌ Fetch Projects Error:", err);
        res.status(500).json({ error: "Server error fetching projects" });
    }
});

// 1a️⃣ Get project by ID
// GET /projects/:id
app.get("/projects/:id", async (req, res) => {
    const { id } = req.params;
    try {
        const request = new sql.Request();
        request.input("ProjectID", sql.Int, id);

        const result = await request.query(`
            SELECT ProjectID, ClientName, Description, EndUser, Duration, Status, CreatedAt, UpdatedAt
            FROM tbl_Projects
            WHERE ProjectID=@ProjectID
        `);

        if (result.recordset.length === 0) {
            return res.status(404).json({ error: "Project not found" });
        }

        res.json(result.recordset[0]);
    } catch (err) {
        console.error("❌ Fetch Project By ID Error:", err);
        res.status(500).json({ error: "Server error fetching project" });
    }
});

// 2️⃣ Add / Update project
// POST /projects
app.post("/projects", async (req, res) => {
    // ProjectID will be null/undefined/0 for INSERT
    const { ProjectID, ClientName, Description, EndUser, Duration, Status } = req.body;

    if (!ClientName || !Description || !Status) {
        return res.status(400).json({ error: "Client Name, Description, and Status are required." });
    }

    try {
        if (ProjectID && ProjectID !== 0) {
            // Update Operation
            const request = new sql.Request(); // Isolated request for UPDATE
            request.input("ProjectID", sql.Int, ProjectID);
            request.input("ClientName", sql.NVarChar, ClientName);
            request.input("Description", sql.NVarChar, Description);
            request.input("EndUser", sql.NVarChar, EndUser || null);
            request.input("Duration", sql.NVarChar, Duration || null);
            request.input("Status", sql.NVarChar, Status);

            await request.query(`
                UPDATE tbl_Projects
                SET 
                    ClientName=@ClientName,
                    Description=@Description,
                    EndUser=@EndUser,
                    Duration=@Duration,
                    Status=@Status,
                    UpdatedAt=GETDATE()
                WHERE ProjectID=@ProjectID
            `);
            res.json({ message: "✅ Project updated successfully", ProjectID });
        } else {
            // Insert Operation
            const request = new sql.Request(); // Isolated request for INSERT
            request.input("ClientName", sql.NVarChar, ClientName);
            request.input("Description", sql.NVarChar, Description);
            request.input("EndUser", sql.NVarChar, EndUser || null);
            request.input("Duration", sql.NVarChar, Duration || null);
            request.input("Status", sql.NVarChar, Status);
            
            const result = await request.query(`
                INSERT INTO tbl_Projects 
                    (ClientName, Description, EndUser, Duration, Status, CreatedAt, UpdatedAt)
                OUTPUT INSERTED.ProjectID 
                VALUES 
                    (@ClientName, @Description, @EndUser, @Duration, @Status, GETDATE(), GETDATE())
            `);
            
            const newProjectId = result.recordset[0].ProjectID;

            res.json({ 
                message: "✅ Project added successfully", 
                ProjectID: newProjectId 
            });
        }
    } catch (err) {
        // Log detailed error and return a more helpful client message
        console.error("❌ Project Save Error:", err);
        res.status(500).json({ error: "Server error saving project.", details: err.message });
    }
});

// 3️⃣ Delete project & related gallery images
// DELETE /projects/:id
app.delete("/projects/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const request = new sql.Request();
        request.input("ProjectID", sql.Int, id);

        // Delete related gallery images first
        await request.query("DELETE FROM tbl_Gallery_Images WHERE ProjectID=@ProjectID");
        // Delete the main project
        await request.query("DELETE FROM tbl_Projects WHERE ProjectID=@ProjectID");

        res.json({ message: "🗑️ Project and related images deleted successfully" });
    } catch (err) {
        console.error("❌ Delete Project Error:", err);
        res.status(500).json({ error: "Server error deleting project" });
    }
});


// ========================================================
// 🖼️ GALLERY ROUTES (Still in index.js for multer access)
// ========================================================

// 2️⃣ Upload gallery images (POST /projects/:projectId/gallery)
// NOTE: This route is defined on 'app' but logically belongs under /projects
app.post("/projects/:projectId/gallery", (req, res, next) => {
    // We use the configured upload middleware
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
            // Store path relative to __dirname for retrieval
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
            // Prepend base URL for client consumption (important!)
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

        // Delete the file from the filesystem
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
    // Single file upload for replacement
    upload.single("image")(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (req.file) cleanupFiles([req.file]);
            return res.status(400).json({ error: "File upload failed: " + err.message });
        } else if (err) {
            if (req.file) cleanupFiles([req.file]);
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
        
        // 1. Fetch old image path to delete it later
        const oldImage = await pool.request()
            .input("GalleryID", sql.Int, id)
            .query("SELECT ImagePath FROM tbl_Gallery_Images WHERE GalleryID=@GalleryID");

        if (!oldImage.recordset.length) {
            if (file) cleanupFiles([{ path: file.path }]); // Use file.path for single file cleanup
            return res.status(404).json({ error: "Image not found." });
        }

        const oldPath = path.join(__dirname, oldImage.recordset[0].ImagePath);
        const newPath = file ? path.join("uploads", "gallery", file.filename) : null;

        // 2. Build the UPDATE query dynamically
        let query = `UPDATE tbl_Gallery_Images SET `;
        let updates = [];
        
        if (projectId) updates.push(`ProjectID = @ProjectID`);
        if (newPath) updates.push(`ImagePath = @ImagePath`);
        
        // Always update the modification timestamp
        updates.push(`UploadedAt = GETDATE()`);
        
        query += updates.join(", ");
        query += ` WHERE GalleryID = @GalleryID`;

        // 3. Prepare the request inputs
        const request = pool.request().input("GalleryID", sql.Int, id);
        if (projectId) request.input("ProjectID", sql.Int, Number(projectId));
        if (newPath) request.input("ImagePath", sql.NVarChar(sql.MAX), newPath);

        // 4. Execute update
        await request.query(query);

        // 5. Cleanup old file if a new file was uploaded
        if (newPath && fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
            console.log(`🗑️ Old image replaced: ${oldPath}`);
        }

        res.json({ message: "✅ Gallery image updated successfully." });
    } catch (err) {
        console.error("❌ Edit Gallery Error:", err);
        if (file) cleanupFiles([{ path: file.path }]);
        res.status(500).json({ error: "Server error during update." });
    }
});


// ========================================================
// 🖥️ SERVE FRONTEND (Optional for React Build)
// ========================================================
// Uncomment this if you have a React frontend build folder
// app.use(express.static(path.join(__dirname, "../client/dist")));
// app.get("*", (req, res) => {
//   res.sendFile(path.join(__dirname, "../client/dist/index.html"));
// });

// ========================================================
// 🚀 START SERVER
// ========================================================
app.listen(PORT, () => console.log(`🚀 Server running at http://localhost:${PORT}`));
