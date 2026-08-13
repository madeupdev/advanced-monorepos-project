import { NextResponse } from "next/server";
import { listTitles } from "@madeup-video/database";

export async function GET() {
  const titles = await listTitles();

  return NextResponse.json({ titles }, { status: 200 });
}
