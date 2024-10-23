require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { auth } = require("./middleware/auth");
const { sendEmail } = require("./middleware/mailer");
const User = require("./models/User");
const Job = require("./models/Job");
const Category = require("./models/Category");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const xlsx = require("xlsx");
const mammoth = require("mammoth");
const extractProfileDetails = require("./middleware/cvExtract");
const Application = require("./models/Application");
const { body, validationResult } = require("express-validator");
const cookieParser = require("cookie-parser");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(cookieParser());

//Multer for storage to the memory - for documents
const path = require("path");
const fs = require("fs");
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}


// Multer configuration for file uploads (CV)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Append timestamp to avoid duplicate names
  },
});

const upload = multer({ storage });

const allowedOrigins = [
  "http://localhost:5174",
  "http://localhost:5173",
  "http://api.amsoljobs.africa",
  "https://amsoljobs.africa",
  "https://amsol-api.onrender.com"  // Just the base URL
];
const corsOptions = {
  origin: (origin, callback) => {
    if (allowedOrigins.includes(origin) || !origin) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

app.use(cors(corsOptions));

// Database Instance
require("dotenv").config();

const mongoURI = process.env.MONGODB_URI;
if (!mongoURI) {
  console.error("MongoDB URI not found in environment variables.");
  process.exit(1);
}

mongoose
  .connect(mongoURI)
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

app.post("/upload-excel", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).send("No file uploaded.");
  }

  try {
    // Read the uploaded Excel file
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0]; // Assume the first sheet contains data
    const sheet = workbook.Sheets[sheetName];

    // Convert sheet data to JSON
    const data = xlsx.utils.sheet_to_json(sheet);

    // Iterate over each row in the Excel data
    for (const row of data) {
      let applicantId = null;
      let jobId = null;

      // Only assign ObjectIds if the fields are present
      if (row.applicant) {
        applicantId = new mongoose.Types.ObjectId(row.applicant);
      }
      if (row.job) {
        jobId = new mongoose.Types.ObjectId(row.job);
      }

      // Handle nested workExperience data
      const workExperience = row["workExperience.company"]
        ? [{
            company: row["workExperience.company"] || "",
            position: row["workExperience.position"] || "",
            duration: row["workExperience.duration"] || "",
          }]
        : [];

      // Create a new application entry
      const newApplication = new Application({
        applicant: applicantId, // Could be null
        job: jobId, // Could be null
        resume: row.resume || "",
        coverLetter: row.coverLetter || "",
        firstName: row.firstName || "",
        secondName: row.secondName || "",
        lastName: row.lastName || "",
        idNumber: row.idNumber || "",
        whatsAppNo: row.whatsAppNo || "",
        phoneNumber: row.phoneNumber || "",
        email: row.email || "",
        age: row.age || 0,
        nationality: row.nationality || "",
        location: row.location || "",
        specialization: row.specialization || "",
        academicLevel: row.academicLevel || "",
        workExperience: workExperience,
        salaryInfo: row.salaryInfo || "",
        cv: row.cv || "",
      });

      // Save the application to the database
      await newApplication.save();
    }

    res.send("Applications uploaded successfully.");
  } catch (error) {
    console.error("Error uploading applications:", error);
    res.status(500).send("Error uploading applications.");
  }
});


app.get("/api/check-session", (req, res) => {
  if (req.session && req.session.user) {
    res.json({ loggedIn: true });
  } else {
    res.json({ loggedIn: false });
  }
});

app.put("/api/profile/picture/:userId", upload.single("file"), async (req, res) => {
  try {
    const filePath = req.file.path;

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      { profilePicture: filePath }, // Assuming you have a field for profile picture in your User model
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile picture uploaded successfully", user: updatedUser });
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post(
  "/api/register",
  [
    body("username").notEmpty().withMessage("Username is required"),
    body("email").isEmail().withMessage("Please enter a valid email address"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters long")
      .matches(/\d/)
      .withMessage("Password must contain a number")
      .matches(/[A-Z]/)
      .withMessage("Password must contain an uppercase letter"),
  ],
  async (req, res) => {
    const { username, email, password, role } = req.body;
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    try {
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: "User already exists" });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      // Create the user object
      const user = new User({
        username,
        email,
        password: hashedPassword,
        role,
      });

      // Save the user
      await user.save();

      // Optionally, generate JWT token here
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
        expiresIn: '1h',
      });

      res.status(201).json({
        message: "User registered successfully",
        id: user._id,
        token: token,  // Return the JWT token
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);


// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: "User doesn't exist" });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "2h",
    });
    res.cookie("token", token, {
      httpOnly: true,
      sameSite: "none",//IAX
      secure: true, // Set true in production with HTTPS
    });
    res.json({ message: "Login successful!", id: user._id, token, role: user.role });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/logout', async (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// Read user by ID endpoint
app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json(user);
  } catch (error) {
    console.error("Error fetching user by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Delete user by ID
app.delete(
  "/api/users/:id",

  async (req, res) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      await user.remove();
      res.json({ message: "User deleted successfully" });
    } catch (error) {
      console.error("Error deleting user:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get all users with pagination GET /api/users?page=1&limit=10
app.get(
  "/api/users",
  async (req, res) => {
    const { page = 1, limit = 10 } = req.query;
    const pageNumber = parseInt(page, 10);
    const pageSize = parseInt(limit, 10);
    try {
      const users = await User.find()
        .select("-password")
        .limit(pageSize)
        .skip((pageNumber - 1) * pageSize);
      const totalUsers = await User.countDocuments();
      res.json({
        total: totalUsers,
        page: pageNumber,
        limit: pageSize,
        users,
      });
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Update user profile details
app.put("/api/profile/:userId", async (req, res) => {
  try {
    const { first_name, last_name, phone, address, email, bio } = req.body.profile;

    // Validate required fields
    if (!phone || !bio) {
      return res.status(400).json({ message: "Phone and bio are required." });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      {
        "profile.first_name": first_name,
        "profile.last_name": last_name,
        "profile.phone": phone,
        "profile.address": address,
        "profile.email": email,
        "profile.bio": bio,
      },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile updated successfully", user: updatedUser });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update user profile endpoint (supports DOCX, PDF, and JSON)
app.put(
  "/api/profile/resume/:id", upload.single("file"),  // Adjust to use the multer configuration defined earlier
  async (req, res) => {
    try {
      const userId = req.params.id;
      const file = req.file;
      let extractedText;
      let profileDetails;

      if (file) {
        // Handle PDF file
        if (file.mimetype === "application/pdf") {
          const filePath = file.path;
          const data = await pdfParse(fs.readFileSync(filePath));
          extractedText = data.text;
        }

        // Handle DOCX files
        if (file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          const filePath = file.path;
          const result = await mammoth.extractRawText({ path: filePath });
          extractedText = result.value;
        }

        if (!extractedText) {
          return res.status(400).json({ message: "Unsupported file type" });
        }

        // Now process extracted text (e.g., profile details extraction)
        profileDetails = extractProfileDetails(extractedText);
      } else {
        if (req.body && Object.keys(req.body).length > 0) {
          profileDetails = req.body;
        } else {
          return res.status(400).json({ message: "No file or profile data provided" });
        }
      }

      // Update user profile
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { profile: profileDetails },
        { new: true }
      );

      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      res.json({
        message: "Profile updated successfully",
        profile: updatedUser.profile,
      });
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Create Job Endpoint
app.post("/api/jobs", async (req, res) => {
  const {
    created_by,
    title,
    description,
    salary_range,
    job_status,
    category_id,
  } = req.body;
  if (!created_by || !title || !description || !salary_range || !category_id) {
    return res.status(400).json({ message: "All fields are required." });
  }
  if (salary_range.min === undefined || salary_range.max === undefined) {
    return res
      .status(400)
      .json({ message: "Salary range must include min and max." });
  }
  try {
    const newJob = new Job({
      created_by,
      title,
      description,
      salary_range,
      job_status,
      category_id,
    });
    const savedJob = await newJob.save();
    res.status(201).json(savedJob);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all jobs with pagination GET /api/jobs?page=1&limit=10
app.get("/api/jobs", async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);

  try {
    const jobs = await Job.find()
      .populate({
        path: "created_by",
        select: "-password",
      })
      .populate("category_id")
      .limit(pageSize)
      .skip((pageNumber - 1) * pageSize);

    const totalJobs = await Job.countDocuments();

    res.json({
      total: totalJobs,
      page: pageNumber,
      limit: pageSize,
      jobs,
    });
  } catch (error) {
    console.error("Error fetching jobs:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get jobs by category
app.get("/api/jobs/category/:categoryId", async (req, res) => {
  const { categoryId } = req.params;
  try {
    const jobs = await Job.find({ category_id: categoryId }).populate(
      "created_by category_id"
    );
    if (!jobs.length) {
      return res
        .status(404)
        .json({ message: "No jobs found for this category." });
    }
    res.json(jobs);
  } catch (error) {
    console.error("Error fetching jobs by category:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get a single job by ID
app.get("/api/jobs/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const job = await Job.findById(id).populate("created_by category_id");
    if (!job) {
      return res.status(404).json({ message: "Job not found." });
    }
    res.json(job);
  } catch (error) {
    console.error("Error fetching job by ID:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Update job
app.put(
  "/api/jobs/:id",

  async (req, res) => {
    try {
      const updatedJob = await Job.findByIdAndUpdate(req.params.id, req.body, {
        new: true,
      });
      if (!updatedJob) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json(updatedJob);
    } catch (error) {
      console.error("Error updating job:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete job
app.delete(
  "/api/jobs/:id",

  async (req, res) => {
    try {
      const deletedJob = await Job.findByIdAndDelete(req.params.id);
      if (!deletedJob) {
        return res.status(404).json({ message: "Job not found" });
      }
      res.json({ message: "Job deleted successfully" });
    } catch (error) {
      console.error("Error deleting job:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get all categories
app.get("/api/categories", async (req, res) => {
  try {
    const categories = await Category.find();
    res.json(categories);
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get a single category by ID
app.get("/api/category/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({ message: "Category not found." });
    }
    res.json(category);
  } catch (error) {
    console.error("Error fetching category by ID:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Create Category Endpoint
app.post(
  "/api/categories",

  async (req, res) => {
    try {
      const { category_name } = req.body;
      if (!category_name) {
        return res.status(400).json({ message: "Category name is required." });
      }
      const newCategory = new Category({
        category_name,
      });
      await newCategory.save();
      res.status(201).json({
        message: "Category created successfully",
        category: newCategory,
      });
    } catch (error) {
      console.error("Error creating category:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Edit Category Endpoint
app.put(
  "/api/categories/:id",

  async (req, res) => {
    try {
      const { id } = req.params;
      const { category_name } = req.body;
      if (!category_name) {
        return res.status(400).json({ message: "Category name is required." });
      }
      const updatedCategory = await Category.findByIdAndUpdate(
        id,
        { category_name },
        { new: true, runValidators: true }
      );
      if (!updatedCategory) {
        return res.status(404).json({ message: "Category not found." });
      }
      res.status(200).json({
        message: "Category updated successfully",
        category: updatedCategory,
      });
    } catch (error) {
      console.error("Error updating category:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete Category Endpoint
app.delete(
  "/api/categories/:id",

  async (req, res) => {
    try {
      const { id } = req.params;
      const deletedCategory = await Category.findByIdAndDelete(id);
      if (!deletedCategory) {
        return res.status(404).json({ message: "Category not found." });
      }
      await Job.updateMany({ category: id }, { $set: { category: null } });
      res.status(200).json({ message: "Category deleted successfully." });
    } catch (error) {
      console.error("Error deleting category:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// File upload route
app.post("/api/applications",
   // Authentication middleware
  upload.single("cv"), // Use this for single file uploads
  [
    body("firstName").notEmpty().withMessage("First name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("idNumber").isNumeric().withMessage("ID Number must be numeric"),
    body("phoneNumber").isMobilePhone().withMessage("Invalid phone number"),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const applicantId = req.user?.id; // Get applicant ID from auth middleware
      if (!applicantId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const {
        jobId,
        firstName,
        secondName,
        lastName,
        idNumber,
        whatsAppNo,
        phoneNumber,
        email,
        age,
        nationality,
        location,
        specialization,
        academicLevel,
        company1,
        position1,
        duration1,
        company2,
        position2,
        duration2,
        company3,
        position3,
        duration3,
        salaryInfo,
      } = req.body;

      // Construct the work experience array
      const workExperience = [
        { company: company1, position: position1, duration: duration1 },
        { company: company2, position: position2, duration: duration2 },
        { company: company3, position: position3, duration: duration3 },
      ];

      const cv = req.file ? req.file.path : null; // Handle CV upload path

      // Assuming you have an Application model to save to MongoDB
      const application = new Application({
        applicant: applicantId,
        job: jobId,
        firstName,
        secondName,
        lastName,
        idNumber,
        whatsAppNo,
        phoneNumber,
        email,
        age,
        nationality,
        location,
        specialization,
        academicLevel,
        workExperience,
        salaryInfo,
        cv,
      });

      await application.save();
      res.status(201).json({
        message: "Application submitted successfully",
        application,
      });
    } catch (error) {
      console.error("Application error:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Get applications (applicant-specific or all for admin)
app.get("/api/applications", async (req, res) => {
  try {
    // Fetch all applications and populate applicant and job information
    const applications = await Application.find()
      .populate("applicant", "-password") // Exclude password field from applicant
      .populate("job"); // Populate job details

    // Return the applications data
    return res.json(applications);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get application by ID
app.get("/api/applications", async (req, res) => {
  try {
    console.log("User Info:", req.user); // Verify user details

    if (req.user.role === "admin" || req.user.role === "super admin") {
      const applications = await Application.find()
        .populate("applicant", "-password")
        .populate("job");
      return res.json(applications);
    } else {
      const applications = await Application.find({
        applicant: req.user.id,
      }).populate("job");
      return res.json(applications);
    }
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ message: "Server error" });
  }
});
// Update application status
app.put("/api/applications/:id/status",

  async (req, res) => {
    const { status } = req.body;
    const validStatuses = ["applied", "interview", "hired", "rejected"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    try {
      const application = await Application.findById(req.params.id);
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }
      application.status = status;
      await application.save();
      var html = "<p>Ola, your application status changed!</p>";
      await sendEmail(
        application.applicant,
        `Job application status changed to: ${status}`,
        html
      );
      res
        .status(200)
        .json({ message: "Application status updated successfully." });
    } catch (error) {
      console.error("Error updating application status:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Delete application
app.delete("/api/applications/:id",

  async (req, res) => {
    try {
      const application = await Application.findByIdAndDelete(req.params.id);
      if (!application) {
        return res.status(404).json({ message: "Application not found" });
      }
      res.json({ message: "Application deleted successfully" });
    } catch (error) {
      console.error("Error deleting application:", error);
      res.status(500).json({ message: "Server error" });
    }
  }
);

// Endpoint to send notifications
app.post("/api/notifications", async (req, res) => {
  const { to, subject, html } = req.body;
  try {
    await sendEmail(to, subject, html);
    res.status(200).json({ message: "Email sent successfully." });
  } catch (error) {
    console.error("Error sending notification:", error);
    res.status(500).json({ message: "Error sending notification." });
  }
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});