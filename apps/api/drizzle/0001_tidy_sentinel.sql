CREATE TABLE `bot` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`charter` text DEFAULT '' NOT NULL,
	`avatar_shape` text NOT NULL,
	`avatar_color` text NOT NULL,
	`model` text DEFAULT 'claude-opus-5-5' NOT NULL,
	`last_message_preview` text,
	`last_message_author` text,
	`last_message_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bot_user_idx` ON `bot` (`user_id`);