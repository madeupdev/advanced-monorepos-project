import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  type ExceptionFilter,
} from "@nestjs/common";

type HttpRequest = {
  method: string;
  originalUrl?: string;
  url: string;
};

type HttpResponse = {
  status(statusCode: number): HttpResponse;
  json(body: unknown): void;
};

@Catch(BadRequestException)
export class InvalidRentalJsonFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequest>();
    const response = http.getResponse<HttpResponse>();
    const requestUrl = request.originalUrl ?? request.url;
    const exceptionResponse = exception.getResponse();
    const isParserBadRequest =
      typeof exceptionResponse === "object" &&
      exceptionResponse !== null &&
      "statusCode" in exceptionResponse &&
      exceptionResponse.statusCode === 400 &&
      "error" in exceptionResponse &&
      exceptionResponse.error === "Bad Request" &&
      "message" in exceptionResponse &&
      typeof exceptionResponse.message === "string";

    if (
      request.method === "POST" &&
      requestUrl === "/api/rentals" &&
      isParserBadRequest
    ) {
      response.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Provide a valid JSON rental request.",
        },
      });
      return;
    }

    response.status(exception.getStatus()).json(exception.getResponse());
  }
}
