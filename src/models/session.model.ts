import mongoose, { Schema, Model, Document } from "mongoose";

// Session document interface
export interface ISession extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  refreshToken: string;
  userAgent?: string;
  ipAddress?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Session schema
const sessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
      unique: true,
    },
    userAgent: {
      type: String,
    },
    ipAddress: {
      type: String,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
sessionSchema.index({ userId: 1 });
sessionSchema.index({ refreshToken: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index for auto-cleanup

export const Session: Model<ISession> = mongoose.model<ISession>(
  "Session",
  sessionSchema
);

export default Session;
