const mongoose = require("mongoose");

const applicationSchema = new mongoose.Schema(
  {
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      
    },
    job: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Job",
      
    },
    resume: {
      type: String,
      
    },
    coverLetter: {
      type: String,
    },
    status: {
      type: String,
      enum: ["applied", "interview", "hired", "rejected"],
      default: "applied",
    },
    // Personal Details
    firstName: { type: String, required: true },
    secondName: { type: String, required: true },
    lastName: { type: String, required: true },
    idNumber: { type: String, required: true },
    whatsAppNo: { type: String },  // Fixed typo
    phoneNumber: { 
      type: String, 
      required: true
      
    },
    email: { type: String, required: true },
    age: { type: Number, required: true },
    nationality: { type: String, required: true },
    location: { type: String, required: true },
    specialization: { type: String },
    academicLevel: {
      type: String,
      enum: [
        "Master's Degree",
        "Postgraduate Diploma",
        "Bachelor’s Degree",
        "Associate's Degree",
        "Diploma",
        "Professional Certificate",
        "others",
      ],
    },
    workExperience: [
      {
        company: { type: String },
        position: { type: String },
        duration: { type: String },
      },
    ],
    totalExperience:{type: String},
    salaryInfo: { type: String },
    cv: { type: String, default:null }
  },
  { timestamps: true }  
);

const Application = mongoose.model("Application", applicationSchema);

module.exports = Application;
