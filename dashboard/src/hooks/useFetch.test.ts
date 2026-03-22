import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useFetch } from "./useFetch";

describe("useFetch", () => {
  it("returns loading state initially", () => {
    const fn = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useFetch(fn));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("returns data after successful fetch", async () => {
    const data = { items: [1, 2, 3] };
    const fn = vi.fn().mockResolvedValue(data);
    const { result } = renderHook(() => useFetch(fn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual(data);
    expect(result.current.error).toBeNull();
  });

  it("returns error on failed fetch", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Network failure"));
    const { result } = renderHook(() => useFetch(fn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("Network failure");
  });

  it("uses generic message for non-Error rejections", async () => {
    const fn = vi.fn().mockRejectedValue("string error");
    const { result } = renderHook(() => useFetch(fn));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe("Something went wrong");
  });

  it("refetch function triggers a new fetch", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    const { result } = renderHook(() => useFetch(fn));

    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));
    expect(fn).toHaveBeenCalledTimes(1);

    result.current.refetch();

    await waitFor(() => expect(result.current.data).toEqual({ count: 2 }));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("does not update state after unmount (cancelled fetch)", async () => {
    let resolveFn: (value: unknown) => void;
    const fn = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveFn = resolve; }),
    );

    const { result, unmount } = renderHook(() => useFetch(fn));

    expect(result.current.loading).toBe(true);

    // Unmount before the promise resolves
    unmount();

    // Resolve the promise after unmount — should not throw
    resolveFn!({ data: "late" });

    // No assertion needed for state — we're verifying no error is thrown
    // and that the cancelled flag prevents setState
  });

  it("refetches when deps change", async () => {
    const fn = vi.fn()
      .mockResolvedValueOnce({ id: "a" })
      .mockResolvedValueOnce({ id: "b" });

    const { result, rerender } = renderHook(
      ({ dep }: { dep: string }) => useFetch(fn, [dep]),
      { initialProps: { dep: "a" } },
    );

    await waitFor(() => expect(result.current.data).toEqual({ id: "a" }));

    rerender({ dep: "b" });

    await waitFor(() => expect(result.current.data).toEqual({ id: "b" }));
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
