import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Param,
  Post,
} from "@nestjs/common";
import {
  createRentalSchema,
  type RentalResponse,
  type RentalsResponse,
} from "@madeup-video/contracts";
import {
  createRental,
  listActiveRentals,
  returnRental,
} from "@madeup-video/database";

@Controller("rentals")
export class RentalsController {
  @Get()
  async listRentals(): Promise<RentalsResponse> {
    return { rentals: await listActiveRentals() };
  }

  @Post()
  async createRental(@Body() body: unknown): Promise<RentalResponse> {
    const parsedRequest = createRentalSchema.safeParse(body);

    if (!parsedRequest.success) {
      throw new HttpException(
        {
          error: {
            code: "INVALID_REQUEST",
            message: "A title ID is required to create a rental.",
          },
        },
        400,
      );
    }

    const result = await createRental(parsedRequest.data.titleId);

    if (!result.ok) {
      const titleMissing = result.reason === "TITLE_NOT_FOUND";

      throw new HttpException(
        {
          error: {
            code: result.reason,
            message: titleMissing
              ? "That title could not be found."
              : "All physical copies of this title are currently rented.",
          },
        },
        titleMissing ? 404 : 409,
      );
    }

    return { rental: result.rental };
  }

  @Post(":id/return")
  @HttpCode(200)
  async returnRental(@Param("id") id: string): Promise<RentalResponse> {
    const result = await returnRental(id);

    if (!result.ok) {
      const rentalMissing = result.reason === "RENTAL_NOT_FOUND";

      throw new HttpException(
        {
          error: {
            code: result.reason,
            message: rentalMissing
              ? "That rental could not be found."
              : "That copy has already been returned.",
          },
        },
        rentalMissing ? 404 : 409,
      );
    }

    return { rental: result.rental };
  }
}
