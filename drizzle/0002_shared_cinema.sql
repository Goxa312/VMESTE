CREATE TABLE `share_peers` (
	`room_id` text NOT NULL,
	`guest` text NOT NULL,
	`session` text NOT NULL,
	`attempt` text NOT NULL,
	`offer` text,
	`answer` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `guest`),
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `upload_parts` (
	`file_id` text NOT NULL,
	`part` integer NOT NULL,
	`tag` text,
	`data` blob,
	PRIMARY KEY(`file_id`, `part`),
	FOREIGN KEY (`file_id`) REFERENCES `uploads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`title` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`backend` text NOT NULL,
	`multipart` text,
	`state` text NOT NULL,
	`revision` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `uploads_room_idx` ON `uploads` (`room_id`);--> statement-breakpoint
CREATE INDEX `uploads_expiry_idx` ON `uploads` (`expires_at`);--> statement-breakpoint
ALTER TABLE `library` ADD `source_mode` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `source_mode` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `share_id` text;