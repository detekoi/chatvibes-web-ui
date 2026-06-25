import { authorizeChannelAccess } from "../auth";
import type { Request, Response } from "express";

describe("Auth Middleware - authorizeChannelAccess", () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: jest.Mock;

  beforeEach(() => {
    mockRequest = {
      params: {},
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFunction = jest.fn();
  });

  it("should call next() if user is authenticated and matches the channel name case-insensitively", () => {
    mockRequest.user = {
      userId: "123",
      userLogin: "TestChannel",
      displayName: "TestChannel",
    };
    mockRequest.params = { channelName: "testchannel" };

    authorizeChannelAccess(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).toHaveBeenCalled();
    expect(mockResponse.status).not.toHaveBeenCalled();
  });

  it("should return 401 if user is not authenticated", () => {
    mockRequest.user = undefined;
    mockRequest.params = { channelName: "testchannel" };

    authorizeChannelAccess(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(401);
    expect(mockResponse.json).toHaveBeenCalledWith({ success: false, message: "Unauthorized: Token not found." });
  });

  it("should return 403 if userLogin does not match channelName", () => {
    mockRequest.user = {
      userId: "123",
      userLogin: "OtherChannel",
      displayName: "OtherChannel",
    };
    mockRequest.params = { channelName: "testchannel" };

    authorizeChannelAccess(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
    expect(mockResponse.json).toHaveBeenCalledWith({ error: "Unauthorized access to channel settings" });
  });

  it("should return 403 if channelName param is missing", () => {
    mockRequest.user = {
      userId: "123",
      userLogin: "TestChannel",
      displayName: "TestChannel",
    };
    mockRequest.params = {};

    authorizeChannelAccess(mockRequest as Request, mockResponse as Response, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();
    expect(mockResponse.status).toHaveBeenCalledWith(403);
  });
});
