// ---------------------------------------------------------------------------
// Tests for LOCAL capabilities (no network): normalization, perceptual
// hashing, target detection. Run with `npm test` (node --test).
// ---------------------------------------------------------------------------

import { test } from "node:test";
import assert from "node:assert/strict";
import { jpegDecodeForTest } from "./helpers.ts";
import { aHash, dHash, hammingDistance, decodeImage } from "../lib/image.ts";
import {
  normalizeEmail,
  normalizeUsername,
  nameSimilarity,
  levenshtein,
  isDisposableDomain,
  extractUrls,
  hostnameOf,
  looksLikeIp,
  looksLikeDomain,
} from "../lib/normalize.ts";
import { detectTarget } from "../lib/detect.ts";

// --- email normalization ---------------------------------------------------

test("gmail dots and plus-tags canonicalize", () => {
  const a = normalizeEmail("John.Doe+newsletter@gmail.com")!;
  const b = normalizeEmail("johndoe@gmail.com")!;
  assert.equal(a.canonical, b.canonical);
  assert.equal(a.normalizedLocal, "johndoe");
  assert.equal(a.isGmail, true);
});

test("outlook plus-tag canonicalization", () => {
  const a = normalizeEmail("jane.doe+work@outlook.com")!;
  const b = normalizeEmail("jane.doe@outlook.com")!;
  assert.equal(a.canonical, b.canonical);
  assert.equal(a.normalizedLocal, "jane.doe");
});

test("custom domain provider detection", () => {
  const a = normalizeEmail("contact@acme-corp.example")!;
  assert.equal(a.provider, "custom");
  assert.equal(a.domain, "acme-corp.example");
});

test("disposable domain detection", () => {
  assert.equal(normalizeEmail("x@mailinator.com")!.isDisposable, true);
  assert.equal(isDisposableDomain("guerrillamail.com"), true);
  assert.equal(normalizeEmail("person@gmail.com")!.isDisposable, false);
});

test("invalid emails rejected", () => {
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail("a@b"), null);
  assert.equal(normalizeEmail("a b@c.com"), null);
});

// --- username normalization ------------------------------------------------

test("username normalization strips @ and stray characters", () => {
  assert.equal(normalizeUsername("@OctoCat"), "octocat");
  assert.equal(normalizeUsername("  Cool.User_1 "), "cool.user_1");
});

test("username similarity", () => {
  assert.equal(nameSimilarity("John Smith", "john smith"), 1);
  assert.ok(nameSimilarity("johnsmith", "johnsmithh") > 0.85);
  assert.ok(nameSimilarity("alice", "zzzzzzzzz") < 0.3);
  assert.equal(levenshtein("kitten", "sitting"), 3);
});

// --- URL helpers -----------------------------------------------------------

test("extract URLs from bio text", () => {
  const urls = extractUrls("Find me at https://example.com/~me and also myblog.dev for more");
  assert.ok(urls.some((u) => u.includes("example.com")));
  assert.ok(urls.some((u) => u.includes("myblog.dev")));
});

test("hostname extraction", () => {
  assert.equal(hostnameOf("https://www.example.com/path?x=1"), "example.com");
  assert.equal(hostnameOf("blog.example.co.uk"), "blog.example.co.uk");
});

test("IP shape detection", () => {
  assert.equal(looksLikeIp("8.8.8.8"), "v4");
  assert.equal(looksLikeIp("2001:4860:4860::8888"), "v6");
  assert.equal(looksLikeIp("999.1.1.1"), null);
  assert.equal(looksLikeIp("example.com"), null);
});

test("domain detection", () => {
  assert.equal(looksLikeDomain("example.com"), true);
  assert.equal(looksLikeDomain("sub.example.co.uk"), true);
  assert.equal(looksLikeDomain("user@example.com"), false);
  assert.equal(looksLikeDomain("8.8.8.8"), false);
});

// --- target auto detection -------------------------------------------------

test("detectTarget classifies inputs", () => {
  assert.equal(detectTarget("user@example.com"), "email");
  assert.equal(detectTarget("8.8.8.8"), "ip");
  assert.equal(detectTarget("example.com"), "domain");
  assert.equal(detectTarget("torvalds"), "username");
  assert.equal(detectTarget("@octocat"), "username");
  assert.equal(detectTarget(""), null);
});

// --- perceptual hash -------------------------------------------------------

test("identical images hash identically", () => {
  const buf = jpegDecodeForTest();
  const img = decodeImage(buf, "image/jpeg")!;
  assert.ok(img);
  const img2 = decodeImage(buf, "image/jpeg")!;
  assert.equal(aHash(img), aHash(img2));
  assert.equal(dHash(img), dHash(img2));
  assert.equal(hammingDistance(dHash(img), dHash(img2)), 0);
});

test("hashes are deterministic and JPEG-stable", () => {
  const imgA1 = decodeImage(jpegDecodeForTest(100), "image/jpeg")!;
  const imgA2 = decodeImage(jpegDecodeForTest(100), "image/jpeg")!;
  assert.ok(imgA1 && imgA2);
  assert.equal(aHash(imgA1), aHash(imgA2));
  assert.equal(dHash(imgA1), dHash(imgA2));
  assert.equal(hammingDistance(aHash(imgA1), aHash(imgA2)), 0);
});
