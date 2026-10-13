import { getStore } from "@netlify/blobs";

// ===== إعدادات =====
// كلمة مرور المعلمة تُضبط من Netlify: Site configuration > Environment variables > TEACHER_PASSWORD
const teacherPassword = () => process.env.TEACHER_PASSWORD || "1234";
const KEY = "roster";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const norm = (t) =>
  String(t || "")
    .replace(/[\u064B-\u0652\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();

const isTeacher = (req) => (req.headers.get("x-teacher-password") || "") === teacherPassword();

const store = () => getStore({ name: "gifted-school", consistency: "strong" });
const loadRoster = async () => (await store().get(KEY, { type: "json" })) || [];
const saveRoster = (list) => store().setJSON(KEY, list);

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];
const TEXT_MAX = 200;
const clip = (v) => String(v ?? "").slice(0, TEXT_MAX);

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const method = req.method;

  try {
    // ---------- الطالبة: دخول ----------
    if (route === "login" && method === "POST") {
      const { name, grade } = await req.json();
      const list = await loadRoster();
      const s = list.find((x) => x.grade == grade && norm(x.name) === norm(name));
      if (!s) return json({ error: "not_found" }, 404);
      s.logins = [...(s.logins || []), Date.now()].slice(-30);
      await saveRoster(list);
      return json({ student: s });
    }

    // ---------- الطالبة: حفظ التقدم ----------
    if (route === "progress" && method === "POST") {
      const { id, done, res } = await req.json();
      const list = await loadRoster();
      const s = list.find((x) => x.id === id);
      if (!s) return json({ error: "not_found" }, 404);
      if (Array.isArray(done)) s.done = done.slice(0, 200).map(clip);
      if (Array.isArray(res)) {
        s.res = res.slice(0, 200).map((r) => ({
          k: clip(r.k), t: clip(r.t), g: Number(r.g) || 0,
          sc: Number(r.sc) || 0, n: Number(r.n) || 0,
          d: Number(r.d) || Date.now(), sent: !!r.sent,
        }));
      }
      await saveRoster(list);
      return json({ ok: true });
    }

    // ---------- المعلمة فقط ----------
    if (route === "students") {
      if (!isTeacher(req)) return json({ error: "unauthorized" }, 401);
      const list = await loadRoster();

      if (method === "GET") return json({ students: list });

      if (method === "POST") {
        const { name, grade, sec } = await req.json();
        const n = clip(name).trim();
        const g = Number(grade);
        if (!n || !GRADES.includes(g)) return json({ error: "bad_request" }, 400);
        const id = `${g}-${n}`.replace(/[\s\/\\'"]/g, "_");
        if (list.some((x) => x.id === id)) return json({ error: "exists" }, 409);
        list.push({ id, name: n, grade: g, sec: clip(sec).trim(), talent: "", src: "", done: [] });
        await saveRoster(list);
        return json({ ok: true });
      }

      if (method === "PUT") {
        const body = await req.json();
        const s = list.find((x) => x.id === body.id);
        if (!s) return json({ error: "not_found" }, 404);
        for (const k of ["talent", "src"]) if (k in body) s[k] = clip(body[k]);
        await saveRoster(list);
        return json({ ok: true });
      }

      if (method === "DELETE") {
        const id = url.searchParams.get("id");
        await saveRoster(list.filter((x) => x.id !== id));
        return json({ ok: true });
      }
    }

    return json({ error: "not_found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "server_error" }, 500);
  }
};

export const config = { path: "/api/*" };
