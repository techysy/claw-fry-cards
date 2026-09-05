import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlushController } from "../src/streaming/flush";

describe("FlushController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("节流窗口内只触发一次 flush", async () => {
    const flush = new FlushController(100);
    flush.setCardMessageReady(true);
    const spy = vi.fn(async () => undefined);

    // 就绪后首次请求落在节流窗口内 → 推迟到窗口边界（~100ms）执行一次
    flush.scheduleUpdate(spy);
    flush.scheduleUpdate(spy);
    flush.scheduleUpdate(spy);
    await vi.advanceTimersByTimeAsync(150);
    expect(spy).toHaveBeenCalledTimes(1);

    // 窗口外的新请求 → 立即 flush
    flush.scheduleUpdate(spy);
    await vi.advanceTimersByTimeAsync(50);
    expect(spy).toHaveBeenCalledTimes(2);
    flush.dispose();
  });

  it("卡片未就绪时忽略更新", () => {
    const flush = new FlushController(100);
    const spy = vi.fn(async () => undefined);
    flush.scheduleUpdate(spy);
    vi.advanceTimersByTime(500);
    expect(spy).not.toHaveBeenCalled();
  });

  it("flush_now 立即执行并等待完成", async () => {
    const flush = new FlushController(100);
    flush.setCardMessageReady(true);
    const order: string[] = [];
    await flush.flushNow(async () => {
      order.push("flushed");
    });
    expect(order).toEqual(["flushed"]);
  });

  it("mark_completed 后不再接受新更新", async () => {
    const flush = new FlushController(100);
    flush.setCardMessageReady(true);
    const spy = vi.fn(async () => undefined);
    flush.markCompleted();
    flush.scheduleUpdate(spy);
    await vi.advanceTimersByTimeAsync(500);
    expect(spy).not.toHaveBeenCalled();
  });

  it("flush 中的异常被吞掉不向外抛", async () => {
    const flush = new FlushController(100);
    flush.setCardMessageReady(true);
    await flush.flushNow(async () => {
      throw new Error("api down");
    });
    // 未抛出即通过
  });

  it("长空闲后延迟小批 flush", async () => {
    const flush = new FlushController(100);
    flush.setCardMessageReady(true);
    const spy = vi.fn(async () => undefined);
    // 首次 flush 在节流窗口边界触发
    flush.scheduleUpdate(spy);
    await vi.advanceTimersByTimeAsync(150);
    expect(spy).toHaveBeenCalledTimes(1);

    // 模拟 3s 空闲 → 下一次更新延迟 BATCH_AFTER_GAP_MS 执行
    const t = Date.now();
    vi.setSystemTime(t + 3000);
    flush.scheduleUpdate(spy);
    await vi.advanceTimersByTimeAsync(50);
    expect(spy).toHaveBeenCalledTimes(1); // 仍在 BATCH_AFTER_GAP 窗口内
    await vi.advanceTimersByTimeAsync(300);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
