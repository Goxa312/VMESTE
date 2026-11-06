CREATE TABLE `account_favorites` (
	`account_id` text NOT NULL,
	`video_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`account_id`, `video_id`),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `account_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `account_limits_expiry_idx` ON `account_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `account_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_sessions_expiry_idx` ON `account_sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`login` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_login_unique` ON `accounts` (`login`);--> statement-breakpoint
ALTER TABLE `participants` ADD `account_id` text REFERENCES accounts(id);--> statement-breakpoint
CREATE UNIQUE INDEX `participants_account_room_idx` ON `participants` (`account_id`,`room_id`);