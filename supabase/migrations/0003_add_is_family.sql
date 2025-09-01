-- Add is_family flag for adult/kid-friendly heuristic
alter table public.events add column if not exists is_family boolean;

