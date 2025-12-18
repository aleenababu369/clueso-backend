import { Request, Response } from "express";
import { User } from "../models/user.model";
import { Session } from "../models/session.model";
import {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  parseExpiryToMs,
} from "../utils/jwt.util";
import { env } from "../config/env";
import { logger } from "../utils/logger";
import crypto from "crypto";

// Cookie options for refresh token
const getRefreshCookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  maxAge: parseExpiryToMs(env.JWT_REFRESH_EXPIRY),
  path: "/",
});

/**
 * Signup - Register a new user
 */
export async function signup(req: Request, res: Response): Promise<void> {
  try {
    const { email, password, name } = req.body;

    // Validate required fields
    if (!email || !password || !name) {
      res.status(400).json({
        success: false,
        error: "Email, password, and name are required",
      });
      return;
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      res.status(400).json({
        success: false,
        error: "User with this email already exists",
      });
      return;
    }

    // Validate password length
    if (password.length < 6) {
      res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
      return;
    }

    // Create user
    const user = new User({
      email: email.toLowerCase(),
      password,
      name,
    });
    await user.save();

    // Generate tokens
    const tokenPayload = { userId: user._id.toString(), email: user.email };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Create session
    const session = new Session({
      userId: user._id,
      refreshToken,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + parseExpiryToMs(env.JWT_REFRESH_EXPIRY)),
    });
    await session.save();

    // Set refresh token in httpOnly cookie
    res.cookie("refreshToken", refreshToken, getRefreshCookieOptions());

    logger.info(`New user registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
      accessToken,
    });
  } catch (error) {
    logger.error("Signup error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to register user",
    });
  }
}

/**
 * Signin - Login with email and password
 */
export async function signin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      res.status(400).json({
        success: false,
        error: "Email and password are required",
      });
      return;
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
      return;
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      res.status(401).json({
        success: false,
        error: "Invalid email or password",
      });
      return;
    }

    // Generate tokens
    const tokenPayload = { userId: user._id.toString(), email: user.email };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Create session
    const session = new Session({
      userId: user._id,
      refreshToken,
      userAgent: req.headers["user-agent"],
      ipAddress: req.ip,
      expiresAt: new Date(Date.now() + parseExpiryToMs(env.JWT_REFRESH_EXPIRY)),
    });
    await session.save();

    // Set refresh token in httpOnly cookie
    res.cookie("refreshToken", refreshToken, getRefreshCookieOptions());

    logger.info(`User logged in: ${user.email}`);

    res.json({
      success: true,
      message: "Login successful",
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
      accessToken,
    });
  } catch (error) {
    logger.error("Signin error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to login",
    });
  }
}

/**
 * Refresh - Get new access token using refresh token
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    // Get refresh token from cookie
    const refreshToken = req.cookies?.refreshToken;

    if (!refreshToken) {
      res.status(401).json({
        success: false,
        error: "Refresh token required",
        code: "NO_REFRESH_TOKEN",
      });
      return;
    }

    // Verify refresh token
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded) {
      res.clearCookie("refreshToken");
      res.status(401).json({
        success: false,
        error: "Invalid or expired refresh token",
        code: "INVALID_REFRESH_TOKEN",
      });
      return;
    }

    // Find session
    const session = await Session.findOne({ refreshToken });
    if (!session) {
      res.clearCookie("refreshToken");
      res.status(401).json({
        success: false,
        error: "Session not found",
        code: "SESSION_NOT_FOUND",
      });
      return;
    }

    // Check if session is expired
    if (session.expiresAt < new Date()) {
      await Session.deleteOne({ _id: session._id });
      res.clearCookie("refreshToken");
      res.status(401).json({
        success: false,
        error: "Session expired",
        code: "SESSION_EXPIRED",
      });
      return;
    }

    // Generate new access token
    const tokenPayload = { userId: decoded.userId, email: decoded.email };
    const accessToken = generateAccessToken(tokenPayload);

    res.json({
      success: true,
      accessToken,
    });
  } catch (error) {
    logger.error("Token refresh error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to refresh token",
    });
  }
}

/**
 * Logout - Invalidate session
 */
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies?.refreshToken;

    if (refreshToken) {
      // Delete session
      await Session.deleteOne({ refreshToken });
    }

    // Clear refresh token cookie
    res.clearCookie("refreshToken");

    res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to logout",
    });
  }
}

/**
 * Get current user profile
 */
export async function me(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Not authenticated",
      });
      return;
    }

    const user = await User.findById(req.user.userId).select("-password");
    if (!user) {
      res.status(404).json({
        success: false,
        error: "User not found",
      });
      return;
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error("Get user error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get user profile",
    });
  }
}

/**
 * Forgot password - Generate reset token
 * For demo purposes, logs the token to console
 */
export async function forgotPassword(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({
        success: false,
        error: "Email is required",
      });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Always return success to prevent email enumeration
    if (!user) {
      res.json({
        success: true,
        message: "If an account exists, a reset link has been sent",
      });
      return;
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour

    // For demo, log the token (in production, send via email)
    logger.info(`Password reset token for ${email}: ${resetToken}`);
    logger.info(
      `Reset link: http://localhost:5173/reset-password?token=${resetToken}&email=${email}`
    );

    // Store reset token in session for demo purposes
    // In production, you'd store this in the user document or a separate collection
    await Session.create({
      userId: user._id,
      refreshToken: `reset_${resetToken}`, // Prefix to distinguish from regular tokens
      expiresAt: new Date(resetTokenExpiry),
    });

    res.json({
      success: true,
      message: "If an account exists, a reset link has been sent",
      // For demo only - remove in production
      ...(env.NODE_ENV === "development" && {
        debug: {
          resetToken,
          resetLink: `http://localhost:5173/reset-password?token=${resetToken}&email=${email}`,
        },
      }),
    });
  } catch (error) {
    logger.error("Forgot password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to process password reset",
    });
  }
}

/**
 * Reset password - Set new password with reset token
 */
export async function resetPassword(
  req: Request,
  res: Response
): Promise<void> {
  try {
    const { email, token, newPassword } = req.body;

    if (!email || !token || !newPassword) {
      res.status(400).json({
        success: false,
        error: "Email, token, and new password are required",
      });
      return;
    }

    if (newPassword.length < 6) {
      res.status(400).json({
        success: false,
        error: "Password must be at least 6 characters",
      });
      return;
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      res.status(400).json({
        success: false,
        error: "Invalid reset link",
      });
      return;
    }

    // Find reset session
    const resetSession = await Session.findOne({
      userId: user._id,
      refreshToken: `reset_${token}`,
      expiresAt: { $gt: new Date() },
    });

    if (!resetSession) {
      res.status(400).json({
        success: false,
        error: "Invalid or expired reset token",
      });
      return;
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Delete reset session
    await Session.deleteOne({ _id: resetSession._id });

    // Delete all other sessions for this user (force re-login)
    await Session.deleteMany({ userId: user._id });

    logger.info(`Password reset successful for: ${user.email}`);

    res.json({
      success: true,
      message:
        "Password reset successful. Please login with your new password.",
    });
  } catch (error) {
    logger.error("Reset password error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to reset password",
    });
  }
}
