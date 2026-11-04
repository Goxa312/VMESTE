CREATE TABLE `library` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_key` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`poster` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_owner_idx` ON `library` (`owner_key`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`name` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_room_idx` ON `messages` (`room_id`,`id`);--> statement-breakpoint
CREATE TABLE `participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text NOT NULL,
	`color` integer NOT NULL,
	`seen_at` integer NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `participants_room_idx` ON `participants` (`room_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`video_url` text NOT NULL,
	`video_title` text NOT NULL,
	`kind` text NOT NULL,
	`poster` text DEFAULT '' NOT NULL,
	`host_id` text NOT NULL,
	`playing` integer DEFAULT 0 NOT NULL,
	`position` real DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
