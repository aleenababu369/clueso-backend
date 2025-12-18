import { Router } from "express";
import {
  signup,
  signin,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post("/signup", signup);

/**
 * @route   POST /api/auth/signin
 * @desc    Login with email and password
 * @access  Public
 */
router.post("/signin", signin);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh access token using refresh token cookie
 * @access  Public (requires valid refresh token cookie)
 */
router.post("/refresh", refresh);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout and invalidate session
 * @access  Public
 */
router.post("/logout", logout);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get("/me", authMiddleware, me);

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post("/forgot-password", forgotPassword);

/**
 * @route   POST /api/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post("/reset-password", resetPassword);

export default router;
