CREATE TABLE `friendships` (
	`id` text PRIMARY KEY NOT NULL,
	`first_id` text NOT NULL,
	`second_id` text NOT NULL,
	`requested_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`accepted_at` integer,
	FOREIGN KEY (`first_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`second_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "friends_order" CHECK("friendships"."first_id" < "friendships"."second_id"),
	CONSTRAINT "friends_requester" CHECK("friendships"."requested_by" IN ("friendships"."first_id", "friendships"."second_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friends_pair_idx` ON `friendships` (`first_id`,`second_id`);--> statement-breakpoint
CREATE INDEX `friends_second_idx` ON `friendships` (`second_id`);--> statement-breakpoint
CREATE TABLE `room_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`friendship_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`friendship_id`) REFERENCES `friendships`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`recipient_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_invites_recipient_room_idx` ON `room_invites` (`recipient_id`,`room_id`);--> statement-breakpoint
CREATE INDEX `room_invites_friendship_idx` ON `room_invites` (`friendship_id`);--> statement-breakpoint
CREATE INDEX `room_invites_room_idx` ON `room_invites` (`room_id`);