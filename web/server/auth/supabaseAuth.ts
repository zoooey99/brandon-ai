import type { RequestHandler } from "express";
import { supabaseAdmin } from "../supabaseClient";
import { authStorage } from "./storage";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
      };
    }
  }
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: "Unauthorized: No token provided" });
    }

    const token = authHeader.substring(7);

    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ message: "Unauthorized: Invalid token" });
    }

    // Ensure user exists in our database
    let dbUser = await authStorage.getUser(user.id);
    if (!dbUser) {
      dbUser = await authStorage.upsertUser({
        id: user.id,
        email: user.email || null,
        firstName: user.user_metadata?.first_name || user.user_metadata?.full_name?.split(' ')[0] || null,
        lastName: user.user_metadata?.last_name || user.user_metadata?.full_name?.split(' ').slice(1).join(' ') || null,
        profileImageUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
    };

    return next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
