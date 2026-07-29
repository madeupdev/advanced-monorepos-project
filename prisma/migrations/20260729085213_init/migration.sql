-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'RENTED');

-- CreateTable
CREATE TABLE "Title" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "synopsis" TEXT NOT NULL,
    "releaseYear" INTEGER NOT NULL,
    "genre" TEXT NOT NULL,
    "certificate" TEXT NOT NULL,
    "runtimeMinutes" INTEGER NOT NULL,
    "artworkKey" TEXT NOT NULL,

    CONSTRAINT "Title_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhysicalCopy" (
    "id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "titleId" TEXT NOT NULL,

    CONSTRAINT "PhysicalCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rental" (
    "id" TEXT NOT NULL,
    "copyId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "rentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "returnedAt" TIMESTAMP(3),

    CONSTRAINT "Rental_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Title_slug_key" ON "Title"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "PhysicalCopy_barcode_key" ON "PhysicalCopy"("barcode");

-- CreateIndex
CREATE INDEX "PhysicalCopy_titleId_status_idx" ON "PhysicalCopy"("titleId", "status");

-- CreateIndex
CREATE INDEX "Rental_returnedAt_idx" ON "Rental"("returnedAt");

-- AddForeignKey
ALTER TABLE "PhysicalCopy" ADD CONSTRAINT "PhysicalCopy_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "Title"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rental" ADD CONSTRAINT "Rental_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "PhysicalCopy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
