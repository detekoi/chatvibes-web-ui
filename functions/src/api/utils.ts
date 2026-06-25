import { Response } from "express";

export function errorResponse(res: Response, status: number, error: string, details?: unknown) {
  res.status(status).json({ 
    success: false as const, 
    error, 
    ...(details !== undefined && { details }) 
  });
}
