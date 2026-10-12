CREATE TABLE `chat_messages` (
	`id` integer PRIMARY KEY NOT NULL,
	`chat_id` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`citations` text DEFAULT '[]' NOT NULL,
	`model` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chat_messages_chat` ON `chat_messages` (`chat_id`,`id`);--> statement-breakpoint
CREATE TABLE `chats` (
	`id` integer PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chats_scope_key_unique` ON `chats` (`scope_key`);--> statement-breakpoint
CREATE TABLE `contents` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`paragraphs` text NOT NULL,
	`full_text` integer NOT NULL,
	`extracted_at` text NOT NULL,
	`paragraphs_ko` text,
	`translated_at` text,
	`translate_model` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `digest_entries` (
	`digest_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`rank` integer NOT NULL,
	`section` text NOT NULL,
	`why_it_matters` text,
	PRIMARY KEY(`digest_id`, `item_id`),
	FOREIGN KEY (`digest_id`) REFERENCES `digests`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `digest_entries_item` ON `digest_entries` (`item_id`);--> statement-breakpoint
CREATE TABLE `digests` (
	`id` integer PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`headline` text NOT NULL,
	`overview` text,
	`stats` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `digests_date_unique` ON `digests` (`date`);--> statement-breakpoint
CREATE TABLE `highlights` (
	`id` integer PRIMARY KEY NOT NULL,
	`item_id` integer NOT NULL,
	`paragraph` integer NOT NULL,
	`variant` text NOT NULL,
	`start_offset` integer NOT NULL,
	`end_offset` integer NOT NULL,
	`text` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `highlights_item` ON `highlights` (`item_id`,`paragraph`);--> statement-breakpoint
CREATE TABLE `item_tags` (
	`item_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`source` text NOT NULL,
	PRIMARY KEY(`item_id`, `tag_id`),
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `item_tags_tag` ON `item_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` integer PRIMARY KEY NOT NULL,
	`url_key` text NOT NULL,
	`url` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`title_norm` text NOT NULL,
	`snippet` text DEFAULT '' NOT NULL,
	`lang` text,
	`published_at` text,
	`collected_at` text NOT NULL,
	`engagement` integer DEFAULT 0 NOT NULL,
	`engagement_label` text,
	`other_sources` text DEFAULT '[]' NOT NULL,
	`triage_category` text,
	`triage_relevance` real,
	`triage_importance` integer,
	`triaged_at` text,
	`title_ko` text,
	`summary_ko` text,
	`key_points` text,
	`summary_model` text,
	`summarized_at` text,
	`merged_into` integer,
	`why_ko` text,
	`follow_up_of` integer,
	FOREIGN KEY (`merged_into`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`follow_up_of`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_url_key_unique` ON `items` (`url_key`);--> statement-breakpoint
CREATE INDEX `items_collected` ON `items` (`collected_at`);--> statement-breakpoint
CREATE INDEX `items_title_norm` ON `items` (`title_norm`);--> statement-breakpoint
CREATE TABLE `llm_usage` (
	`id` integer PRIMARY KEY NOT NULL,
	`at` text NOT NULL,
	`run_id` integer,
	`role` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`cached_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`reasoning_tokens` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`cost_usd` real NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_usage_at` ON `llm_usage` (`at`);--> statement-breakpoint
CREATE TABLE `notes` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reads` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`read_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` integer PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`since` text NOT NULL,
	`error` text,
	`stats` text
);
--> statement-breakpoint
CREATE TABLE `saves` (
	`item_id` integer PRIMARY KEY NOT NULL,
	`saved_at` text NOT NULL,
	`enriched_at` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_fetches` (
	`id` integer PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`at` text NOT NULL,
	`reason` text NOT NULL,
	`ok` integer NOT NULL,
	`fetched` integer NOT NULL,
	`new_items` integer NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE INDEX `source_fetches_source` ON `source_fetches` (`source_id`,`at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text COLLATE NOCASE NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_name_unique` ON `tags` (`name`);