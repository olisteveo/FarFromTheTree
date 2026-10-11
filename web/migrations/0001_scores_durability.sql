-- Leaf durability at the finish (0 to 100, % of the leaf left), stored with each score.
-- Older rows stay NULL. functions/api/_db.ts also adds this column lazily on first use, so if
-- the API has already run since this shipped, this fails with "duplicate column name": harmless.
ALTER TABLE scores ADD COLUMN durability INTEGER;
