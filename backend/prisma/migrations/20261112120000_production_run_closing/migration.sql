-- Phase 8 · Closing the batch: who closed a production run, and when. Null = still running.
ALTER TABLE "ProductionBatch" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "ProductionBatch" ADD COLUMN "closedById" TEXT;

ALTER TABLE "ProductionBatch" ADD CONSTRAINT "ProductionBatch_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
