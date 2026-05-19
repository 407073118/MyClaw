import React, { useEffect, useId, useMemo, useRef, useState } from "react";

export type GlassSelectOption = {
  label: string;
  value: string;
  disabled?: boolean;
  description?: string;
};

type GlassSelectProps = {
  value: string;
  options: GlassSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  id?: string;
  "data-testid"?: string;
};

/** 渲染项目统一下拉框，隐藏原生 select 只保留表单与测试兼容入口。 */
export function GlassSelect({
  value,
  options,
  onChange,
  placeholder = "请选择",
  ariaLabel,
  disabled = false,
  className = "",
  name,
  id,
  "data-testid": testId,
}: GlassSelectProps) {
  const generatedId = useId();
  const safeGeneratedId = useMemo(() => generatedId.replace(/[^a-zA-Z0-9_-]/g, "-"), [generatedId]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const listboxId = `${id ?? safeGeneratedId}-listbox`;
  const enabledOptions = useMemo(() => options.filter((option) => !option.disabled), [options]);
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const firstEnabledIndex = options.findIndex((option) => !option.disabled);
  const selectedIndex = options.findIndex((option) => option.value === value);

  /** 打开下拉列表，并把键盘焦点定位到当前选项或第一个可选项。 */
  function openMenu() {
    if (disabled) return;
    const nextIndex = selectedIndex >= 0 ? selectedIndex : Math.max(firstEnabledIndex, 0);
    console.info("[glass-select] 打开项目风格下拉框", {
      label: ariaLabel ?? name ?? testId ?? "未命名下拉框",
      value,
      activeIndex: nextIndex,
    });
    setActiveIndex(nextIndex);
    setOpen(true);
  }

  /** 关闭下拉列表，必要时把焦点还给触发按钮。 */
  function closeMenu(restoreFocus = false) {
    if (!open) return;
    console.info("[glass-select] 关闭项目风格下拉框", {
      label: ariaLabel ?? name ?? testId ?? "未命名下拉框",
      value,
    });
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }

  /** 提交用户选择的选项，并同步隐藏原生 select 的值。 */
  function commitValue(nextValue: string) {
    const nextOption = options.find((option) => option.value === nextValue);
    if (!nextOption || nextOption.disabled) return;
    console.info("[glass-select] 选择项目风格下拉项", {
      label: ariaLabel ?? name ?? testId ?? "未命名下拉框",
      value: nextValue,
    });
    onChange(nextValue);
    closeMenu(true);
  }

  /** 根据当前激活项移动到下一个可选项，跳过禁用项。 */
  function moveActive(delta: number) {
    if (enabledOptions.length === 0) return;
    const currentValue = options[activeIndex]?.value;
    const currentEnabledIndex = Math.max(enabledOptions.findIndex((option) => option.value === currentValue), 0);
    const nextEnabledIndex = (currentEnabledIndex + delta + enabledOptions.length) % enabledOptions.length;
    const nextIndex = options.findIndex((option) => option.value === enabledOptions[nextEnabledIndex]?.value);
    console.info("[glass-select] 移动下拉框键盘焦点", {
      label: ariaLabel ?? name ?? testId ?? "未命名下拉框",
      activeIndex: nextIndex,
    });
    setActiveIndex(Math.max(nextIndex, 0));
  }

  /** 处理键盘操作，保证自定义下拉框保留原生控件的基础可访问性。 */
  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(-1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      commitValue(options[activeIndex]?.value ?? "");
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  }

  /** 监听外部点击，避免下拉菜单留在界面上挡住其他控件。 */
  useEffect(() => {
    if (!open) return;
    function handleDocumentPointerDown(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      console.info("[glass-select] 点击外部关闭项目风格下拉框", {
        label: ariaLabel ?? name ?? testId ?? "未命名下拉框",
        value,
      });
      setOpen(false);
    }
    document.addEventListener("mousedown", handleDocumentPointerDown);
    return () => document.removeEventListener("mousedown", handleDocumentPointerDown);
  }, [ariaLabel, name, open, testId, value]);

  return (
    <div ref={rootRef} className={`glass-select ${open ? "is-open" : ""} ${className}`.trim()}>
      <select
        id={id}
        name={name}
        data-testid={testId}
        className="glass-select__native"
        value={value}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => commitValue(event.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        ref={buttonRef}
        type="button"
        className="glass-select__button"
        data-testid={testId ? `${testId}-control` : undefined}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-option-${Math.max(activeIndex, 0)}` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className={`glass-select__value${selectedOption ? "" : " is-placeholder"}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="glass-select__chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open && (
        <div id={listboxId} className="glass-select__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              key={option.value}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={`glass-select__option${option.value === value ? " is-selected" : ""}${index === activeIndex ? " is-active" : ""}`}
              disabled={option.disabled}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => commitValue(option.value)}
            >
              <span className="glass-select__option-copy">
                <span className="glass-select__option-label">{option.label}</span>
                {option.description ? <span className="glass-select__option-description">{option.description}</span> : null}
              </span>
              <span className="glass-select__option-check" aria-hidden="true">
                {option.value === value ? "✓" : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
