import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { randomUUID } from "crypto";
import { db } from "../db";
import { requireAuth } from "./auth";

db.exec(`
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    object_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    review_html TEXT NOT NULL DEFAULT '',
    score INTEGER NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, object_id, shop)
  );
  CREATE TABLE IF NOT EXISTS review_answers (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    answer_html TEXT NOT NULL,
    upvotes INTEGER NOT NULL DEFAULT 0,
    downvotes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS review_votes (
    user_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    vote_type TEXT NOT NULL,
    PRIMARY KEY(user_id, target_id)
  );
`);

function formatReview(r: any, userId: string | null): any {
  const user = db.prepare("SELECT id, display_name, profile_image_url FROM users WHERE id = ?").get(r.user_id) as any;
  const answers = db.prepare("SELECT * FROM review_answers WHERE review_id = ? ORDER BY created_at ASC LIMIT 3").all(r.id) as any[];
  const answerCount = (db.prepare("SELECT COUNT(*) as c FROM review_answers WHERE review_id = ?").get(r.id) as any).c;
  const userVote = userId ? (db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(userId, r.id) as any) : null;
  return {
    id: r.id,
    reviewHtml: r.review_html,
    score: r.score,
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
    upvotes: r.upvotes,
    downvotes: r.downvotes,
    answerCount,
    answers: answers.map(a => formatAnswer(a, userId)),
    isBlocked: false,
    hasUpvoted: userVote?.vote_type === "upvote",
    hasDownvoted: userVote?.vote_type === "downvote",
    user: { id: user?.id ?? r.user_id, displayName: user?.display_name ?? "", profileImageUrl: user?.profile_image_url ?? null },
    translations: {},
    detectedLanguage: null,
  };
}

function formatAnswer(a: any, userId: string | null): any {
  const user = db.prepare("SELECT id, display_name, profile_image_url FROM users WHERE id = ?").get(a.user_id) as any;
  const userVote = userId ? (db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(userId, a.id) as any) : null;
  return {
    id: a.id,
    answerHtml: a.answer_html,
    createdAt: new Date(a.created_at * 1000).toISOString(),
    updatedAt: new Date(a.updated_at * 1000).toISOString(),
    upvotes: a.upvotes,
    downvotes: a.downvotes,
    isBlocked: false,
    hasUpvoted: userVote?.vote_type === "upvote",
    hasDownvoted: userVote?.vote_type === "downvote",
    user: { id: user?.id ?? a.user_id, displayName: user?.display_name ?? "", profileImageUrl: user?.profile_image_url ?? null },
    translations: {},
    detectedLanguage: null,
  };
}

export async function reviewsRoutes(app: FastifyInstance) {
  // GET /games/:shop/:objectId/reviews/check
  app.get("/games/:shop/:objectId/reviews/check",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string } }>) => {
      const user = (req as any).user;
      const { shop, objectId } = req.params;
      const row = db.prepare("SELECT id FROM reviews WHERE user_id = ? AND object_id = ? AND shop = ?").get(user.id, objectId, shop);
      return { hasReviewed: !!row };
    }
  );

  // GET /games/:shop/:objectId/reviews
  app.get("/games/:shop/:objectId/reviews",
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string }; Querystring: { take?: string; skip?: string; sortBy?: string } }>, reply: FastifyReply) => {
      const { shop, objectId } = req.params;
      const take = parseInt(req.query.take ?? "20");
      const skip = parseInt(req.query.skip ?? "0");
      const sortBy = req.query.sortBy ?? "createdAt";
      const order = sortBy === "score" ? "score DESC" : sortBy === "upvotes" ? "upvotes DESC" : "created_at DESC";
      const userId = (req as any).user?.id ?? null;
      const reviews = db.prepare(`SELECT * FROM reviews WHERE object_id = ? AND shop = ? ORDER BY ${order} LIMIT ? OFFSET ?`).all(objectId, shop, take, skip) as any[];
      const totalCount = (db.prepare("SELECT COUNT(*) as c FROM reviews WHERE object_id = ? AND shop = ?").get(objectId, shop) as any).c;
      return { reviews: reviews.map(r => formatReview(r, userId)), totalCount };
    }
  );

  // POST /games/:shop/:objectId/reviews
  app.post("/games/:shop/:objectId/reviews",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string }; Body: { reviewHtml?: string; score?: number } }>, reply: FastifyReply) => {
      const user = (req as any).user;
      const { shop, objectId } = req.params;
      const { reviewHtml = "", score } = req.body ?? {};
      if (score == null) return reply.code(400).send({ error: "score required" });
      const id = randomUUID();
      db.prepare("INSERT INTO reviews(id, user_id, object_id, shop, review_html, score) VALUES(?,?,?,?,?,?)").run(id, user.id, objectId, shop, reviewHtml, score);
      const row = db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as any;
      return formatReview(row, user.id);
    }
  );

  // DELETE /games/:shop/:objectId/reviews/:reviewId
  app.delete("/games/:shop/:objectId/reviews/:reviewId",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string; reviewId: string } }>, reply: FastifyReply) => {
      const user = (req as any).user;
      const { reviewId } = req.params;
      db.prepare("DELETE FROM reviews WHERE id = ? AND user_id = ?").run(reviewId, user.id);
      return { ok: true };
    }
  );

  // PUT /games/:shop/:objectId/reviews/:reviewId/:voteType
  app.put("/games/:shop/:objectId/reviews/:reviewId/:voteType",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string; reviewId: string; voteType: string } }>, reply: FastifyReply) => {
      const user = (req as any).user;
      const { reviewId, voteType } = req.params;
      const existing = db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(user.id, reviewId) as any;
      if (existing?.vote_type === voteType) {
        db.prepare("DELETE FROM review_votes WHERE user_id = ? AND target_id = ?").run(user.id, reviewId);
        db.prepare(`UPDATE reviews SET ${voteType}s = ${voteType}s - 1 WHERE id = ?`).run(reviewId);
      } else {
        if (existing) db.prepare(`UPDATE reviews SET ${existing.vote_type}s = ${existing.vote_type}s - 1 WHERE id = ?`).run(reviewId);
        db.prepare("INSERT OR REPLACE INTO review_votes(user_id, target_id, vote_type) VALUES(?,?,?)").run(user.id, reviewId, voteType);
        db.prepare(`UPDATE reviews SET ${voteType}s = ${voteType}s + 1 WHERE id = ?`).run(reviewId);
      }
      return { ok: true };
    }
  );

  // GET /games/:shop/:objectId/reviews/:reviewId/answers
  app.get("/games/:shop/:objectId/reviews/:reviewId/answers",
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string; reviewId: string }; Querystring: { take?: string; skip?: string } }>) => {
      const { reviewId } = req.params;
      const take = parseInt(req.query.take ?? "20");
      const skip = parseInt(req.query.skip ?? "0");
      const userId = (req as any).user?.id ?? null;
      const answers = db.prepare("SELECT * FROM review_answers WHERE review_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?").all(reviewId, take, skip) as any[];
      const totalCount = (db.prepare("SELECT COUNT(*) as c FROM review_answers WHERE review_id = ?").get(reviewId) as any).c;
      return { answers: answers.map(a => formatAnswer(a, userId)), totalCount };
    }
  );

  // POST /games/:shop/:objectId/reviews/:reviewId/answers
  app.post("/games/:shop/:objectId/reviews/:reviewId/answers",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { shop: string; objectId: string; reviewId: string }; Body: { answerHtml?: string } }>, reply: FastifyReply) => {
      const user = (req as any).user;
      const { reviewId } = req.params;
      const { answerHtml = "" } = req.body ?? {};
      const id = randomUUID();
      db.prepare("INSERT INTO review_answers(id, review_id, user_id, answer_html) VALUES(?,?,?,?)").run(id, reviewId, user.id, answerHtml);
      const row = db.prepare("SELECT * FROM review_answers WHERE id = ?").get(id) as any;
      return formatAnswer(row, user.id);
    }
  );

  // PUT /games/:shop/:objectId/reviews/:reviewId/answers/:answerId/:voteType
  app.put("/games/:shop/:objectId/reviews/:reviewId/answers/:answerId/:voteType",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: any }>, reply: FastifyReply) => {
      const user = (req as any).user;
      const { answerId, voteType } = req.params;
      const existing = db.prepare("SELECT vote_type FROM review_votes WHERE user_id = ? AND target_id = ?").get(user.id, answerId) as any;
      if (existing?.vote_type === voteType) {
        db.prepare("DELETE FROM review_votes WHERE user_id = ? AND target_id = ?").run(user.id, answerId);
        db.prepare(`UPDATE review_answers SET ${voteType}s = ${voteType}s - 1 WHERE id = ?`).run(answerId);
      } else {
        if (existing) db.prepare(`UPDATE review_answers SET ${existing.vote_type}s = ${existing.vote_type}s - 1 WHERE id = ?`).run(answerId);
        db.prepare("INSERT OR REPLACE INTO review_votes(user_id, target_id, vote_type) VALUES(?,?,?)").run(user.id, answerId, voteType);
        db.prepare(`UPDATE review_answers SET ${voteType}s = ${voteType}s + 1 WHERE id = ?`).run(answerId);
      }
      return { ok: true };
    }
  );

  // DELETE /games/:shop/:objectId/reviews/:reviewId/answers/:answerId
  app.delete("/games/:shop/:objectId/reviews/:reviewId/answers/:answerId",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: any }>, reply: FastifyReply) => {
      const user = (req as any).user;
      const { answerId } = req.params;
      db.prepare("DELETE FROM review_answers WHERE id = ? AND user_id = ?").run(answerId, user.id);
      return { ok: true };
    }
  );
}
