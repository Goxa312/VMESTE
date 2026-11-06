ALTER TABLE `participants` ADD `on_break` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `participants` ADD `break_changed_at` integer DEFAULT 0 NOT NULL;