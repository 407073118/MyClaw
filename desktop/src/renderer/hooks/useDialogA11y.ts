import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

interface UseDialogA11yOptions {
  isOpen: boolean;
  onClose: () => void;
  initialFocusRef: RefObject<HTMLElement | null>;
  dialogName: string;
}

/** 管理弹层的 Escape 关闭、初始焦点和关闭后的焦点回收。 */
export function useDialogA11y({
  isOpen,
  onClose,
  initialFocusRef,
  dialogName,
}: UseDialogA11yOptions) {
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** 记录打开弹层前的触发元素，关闭时把焦点还给它。 */
  const captureTrigger = useCallback((target?: HTMLElement | null) => {
    returnFocusRef.current =
      target ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    if (!returnFocusRef.current && document.activeElement instanceof HTMLElement) {
      returnFocusRef.current = document.activeElement;
    }

    const focusFrame = window.requestAnimationFrame(() => {
      initialFocusRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      console.info("[dialog] 通过 Escape 关闭弹层", { dialogName });
      onCloseRef.current();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);

      const trigger = returnFocusRef.current;
      returnFocusRef.current = null;
      if (trigger) {
        trigger.focus();
      }
    };
  }, [dialogName, initialFocusRef, isOpen]);

  return { captureTrigger };
}
