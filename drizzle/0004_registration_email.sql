ALTER TABLE `accounts` ADD `email` text;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);