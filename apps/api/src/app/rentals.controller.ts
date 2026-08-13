import { Controller, Get } from "@nestjs/common";
import type { RentalsResponse } from "@madeup-video/contracts";
import { listActiveRentals } from "@madeup-video/database";

@Controller("rentals")
export class RentalsController {
  @Get()
  async listRentals(): Promise<RentalsResponse> {
    return { rentals: await listActiveRentals() };
  }
}
