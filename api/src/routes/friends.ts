import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { db } from "../db";
import { requireAuth } from "./auth";

interface DbUser { id: string; username: string; display_name: string; profile_image_url: string | null; }
interface DbFriendship { id: string; requester_id: string; addressee_id: string; status: string; }

function formatFriend(user: DbUser, friendship: DbFriendship, myId: string) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    profileImageUrl: user.profile_image_url,
    friendshipId: friendship.id,
    status: friendship.status,
    type: friendship.requester_id === myId ? "sent" : "received",
  };
}

export async function friendsRoutes(app: FastifyInstance) {
  // Search users
  app.get(
    "/users/search",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { q?: string } }>) => {
      const q = `%${req.query.q ?? ""}%`;
      const users = db
        .prepare("SELECT id, username, display_name, profile_image_url FROM users WHERE username LIKE ? OR display_name LIKE ? LIMIT 20")
        .all(q, q) as DbUser[];
      return users.map((u) => ({ id: u.id, username: u.username, displayName: u.display_name, profileImageUrl: u.profile_image_url }));
    }
  );

  // Send friend request
  app.post(
    "/profile/friends/requests",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Body: { userId: string } }>, reply: FastifyReply) => {
      const myId = (req as any).userId;
      const { userId } = req.body;
      if (myId === userId) return reply.code(400).send({ error: "cannot add yourself" });

      const existing = db.prepare(
        "SELECT id FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)"
      ).get(myId, userId, userId, myId);
      if (existing) return reply.code(409).send({ error: "already exists" });

      const id = crypto.randomUUID();
      db.prepare("INSERT INTO friendships (id, requester_id, addressee_id) VALUES (?, ?, ?)").run(id, myId, userId);
      return { id };
    }
  );

  // List friends / requests
  app.get(
    "/profile/friends",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Querystring: { take?: string; skip?: string } }>) => {
      const myId = (req as any).userId;
      const friendships = db.prepare(
        "SELECT * FROM friendships WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'"
      ).all(myId, myId) as DbFriendship[];

      const results = friendships.map((f) => {
        const otherId = f.requester_id === myId ? f.addressee_id : f.requester_id;
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(otherId) as DbUser;
        return user ? formatFriend(user, f, myId) : null;
      }).filter(Boolean);

      return { results, total: results.length };
    }
  );

  // Incoming friend requests
  app.get(
    "/profile/friends/requests/received",
    { preHandler: requireAuth },
    async (req: FastifyRequest) => {
      const myId = (req as any).userId;
      const friendships = db.prepare(
        "SELECT * FROM friendships WHERE addressee_id = ? AND status = 'pending'"
      ).all(myId) as DbFriendship[];

      const results = friendships.map((f) => {
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(f.requester_id) as DbUser;
        return user ? formatFriend(user, f, myId) : null;
      }).filter(Boolean);

      return { results, total: results.length };
    }
  );

  // Outgoing friend requests
  app.get(
    "/profile/friends/requests/sent",
    { preHandler: requireAuth },
    async (req: FastifyRequest) => {
      const myId = (req as any).userId;
      const friendships = db.prepare(
        "SELECT * FROM friendships WHERE requester_id = ? AND status = 'pending'"
      ).all(myId) as DbFriendship[];

      const results = friendships.map((f) => {
        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(f.addressee_id) as DbUser;
        return user ? formatFriend(user, f, myId) : null;
      }).filter(Boolean);

      return { results, total: results.length };
    }
  );

  // Accept friend request
  app.put(
    "/profile/friends/requests/:id/accept",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const myId = (req as any).userId;
      const f = db.prepare("SELECT * FROM friendships WHERE id = ? AND addressee_id = ? AND status = 'pending'").get(req.params.id, myId);
      if (!f) return reply.code(404).send({ error: "not found" });
      db.prepare("UPDATE friendships SET status = 'accepted' WHERE id = ?").run(req.params.id);
      return {};
    }
  );

  // Refuse/remove friend
  app.delete(
    "/profile/friends/:id",
    { preHandler: requireAuth },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const myId = (req as any).userId;
      const f = db.prepare(
        "SELECT id FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?)"
      ).get(req.params.id, myId, myId);
      if (!f) return reply.code(404).send({ error: "not found" });
      db.prepare("DELETE FROM friendships WHERE id = ?").run(req.params.id);
      return {};
    }
  );

  // Friend request count for notifications
  app.get(
    "/profile/notifications/count",
    { preHandler: requireAuth },
    async (req: FastifyRequest) => {
      const myId = (req as any).userId;
      const count = (db.prepare("SELECT COUNT(*) as c FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(myId) as any).c;
      return { count };
    }
  );
}
