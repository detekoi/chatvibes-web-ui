/**
 * Authentication middleware for API requests
 */
import type { Request, Response, NextFunction } from "express";
interface JwtPayload {
    userId: string;
    userLogin: string;
    displayName: string;
    scope?: string;
    tokenUser?: string;
}
interface AuthenticatedUser {
    userId: string;
    userLogin: string;
    displayName: string;
    scope?: string;
    tokenUser?: string;
}
declare global {
    namespace Express {
        interface Request {
            user?: AuthenticatedUser;
        }
    }
}
/**
 * Middleware to authenticate API requests using JWT tokens
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 * @return Calls next() or sends error response
 */
declare const authenticateApiRequest: (req: Request, res: Response, next: NextFunction) => void;
export { authenticateApiRequest, };
export type { JwtPayload, AuthenticatedUser, };
//# sourceMappingURL=auth.d.ts.map