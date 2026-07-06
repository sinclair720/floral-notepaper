import { useMemo, useState, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";

/** 表示一个标题条目 */
interface TocHeading {
  /** 标题层级: 1~6 */
  level: number;
  /** 标题文本（去除 Markdown 行内标记后的纯文本） */
  text: string;
  /** 标题在原始内容中的行号（0-based） */
  line: number;
  /** 用于锚点定位的 slug，与 rehype-slug 生成的 id 一致 */
  slug: string;
}

interface TocPanelProps {
  /** 当前笔记的 Markdown 原始文本 */
  content: string;
  /** 用户点击某个标题时的回调 */
  onClickHeading: (heading: TocHeading) => void;
  /** 面板是否可见 */
  visible: boolean;
  /** 关闭面板的回调 */
  onClose: () => void;
}

// ---------- slug 生成 ----------
// rehype-slug 使用 github-slugger，其核心算法：
//   1. 转小写
//   2. 去除非字母数字和空格（保留中文等 Unicode 字符）
//   3. 空格替换为 -
//   4. 重复的 slug 后追加 -1, -2, ...
// 这里复刻一个轻量版本，确保与渲染后的 id 一致。

function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "") // 去除标点和特殊字符，保留字母、数字、空格、连字符
    .replace(/[\s]+/g, "-") // 空格替换为连字符
    .replace(/-+/g, "-") // 合并多个连字符
    .replace(/^-|-$/g, ""); // 去首尾连字符
}

/** 从原始 Markdown 文本中的标题行文字剥离行内 Markdown 格式 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1") // **bold**
    .replace(/__(.+?)__/g, "$1") // __bold__
    .replace(/\*(.+?)\*/g, "$1") // *italic*
    .replace(/_(.+?)_/g, "$1") // _italic_
    .replace(/~~(.+?)~~/g, "$1") // ~~strikethrough~~
    .replace(/`(.+?)`/g, "$1") // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // [link](url)
    .trim();
}

// ---------- 标题解析 ----------

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;

function parseHeadings(content: string): TocHeading[] {
  const lines = content.split("\n");
  const headings: TocHeading[] = [];
  const slugCounts = new Map<string, number>();
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 跳过代码块内的内容
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) continue;

    const match = line.match(HEADING_REGEX);
    if (!match) continue;

    const level = match[1].length;
    const rawText = stripInlineMarkdown(match[2]);
    const baseSlug = githubSlug(rawText);

    // 处理重复 slug（与 github-slugger 行为一致）
    const count = slugCounts.get(baseSlug) ?? 0;
    const slug = count > 0 ? `${baseSlug}-${count}` : baseSlug;
    slugCounts.set(baseSlug, count + 1);

    headings.push({ level, text: rawText, line: i, slug });
  }

  return headings;
}

/** 返回一个 Set，包含所有拥有子标题的标题 slug */
function findParentSlugs(headings: TocHeading[]): Set<string> {
  const parents = new Set<string>();
  for (let i = 0; i < headings.length - 1; i++) {
    if (headings[i + 1].level > headings[i].level) {
      parents.add(headings[i].slug);
    }
  }
  return parents;
}

/** 判断某个标题是否因为祖先被折叠而应该被隐藏 */
function isHeadingHidden(
  index: number,
  headings: TocHeading[],
  collapsedSlugs: Set<string>,
): boolean {
  const currentLevel = headings[index].level;
  // 向前遍历，找层级比自己浅的最近祖先
  for (let i = index - 1; i >= 0; i--) {
    if (headings[i].level < currentLevel) {
      if (collapsedSlugs.has(headings[i].slug)) {
        return true;
      }
      // 继续向上检查所有祖先（间接折叠）
      return isHeadingHidden(i, headings, collapsedSlugs);
    }
  }
  return false;
}

// ---------- 组件 ----------

export function TocPanel({ content, onClickHeading, visible, onClose }: TocPanelProps) {
  const { t } = useTranslation();
  const headings = useMemo(() => parseHeadings(content), [content]);

  // 折叠状态（存储被折叠的父标题 slug）
  const [collapsedSlugs, setCollapsedSlugs] = useState<Set<string>>(new Set());

  // 当内容变化（如切换笔记）时，重置折叠状态为全部展开
  useEffect(() => {
    setCollapsedSlugs(new Set());
  }, [content]);

  // 哪些标题是父标题（拥有子标题）
  const parentSlugs = useMemo(() => findParentSlugs(headings), [headings]);

  // 切换单个标题的折叠状态
  const toggleCollapse = useCallback((slug: string) => {
    setCollapsedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      return next;
    });
  }, []);

  // 全部展开
  const expandAll = useCallback(() => {
    setCollapsedSlugs(new Set());
  }, []);

  // 全部折叠
  const collapseAll = useCallback(() => {
    setCollapsedSlugs(new Set(parentSlugs));
  }, [parentSlugs]);

  if (!visible) return null;

  // 计算最小层级，用于相对缩进
  // （如果文档从 ## 开始，则 ## 不缩进，### 缩进 1 级）
  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  const allCollapsed = parentSlugs.size > 0 && collapsedSlugs.size >= parentSlugs.size;

  return (
    <div className="toc-panel">
      <div className="toc-panel-header">
        <span className="toc-panel-title">{t("main.toc.title", { defaultValue: "目录" })}</span>
        <div className="toc-panel-actions">
          {parentSlugs.size > 0 && (
            <button
              type="button"
              onClick={allCollapsed ? expandAll : collapseAll}
              className="toc-panel-collapse-all"
              title={
                allCollapsed
                  ? t("main.toc.expandAll", { defaultValue: "展开全部" })
                  : t("main.toc.collapseAll", { defaultValue: "折叠全部" })
              }
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {allCollapsed ? (
                  <>
                    <polyline points="7 8 12 13 17 8" />
                    <polyline points="7 14 12 19 17 14" />
                  </>
                ) : (
                  <>
                    <polyline points="17 16 12 11 7 16" />
                    <polyline points="17 10 12 5 7 10" />
                  </>
                )}
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="toc-panel-close"
            title={t("main.toc.close", { defaultValue: "关闭目录" })}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      <div className="toc-panel-body">
        {headings.length === 0 ? (
          <p className="toc-panel-empty">{t("main.toc.empty", { defaultValue: "暂无标题" })}</p>
        ) : (
          <ul className="toc-panel-list">
            {headings.map((heading, index) => {
              if (isHeadingHidden(index, headings, collapsedSlugs)) return null;

              const isParent = parentSlugs.has(heading.slug);
              const isCollapsed = collapsedSlugs.has(heading.slug);

              return (
                <li key={`${heading.slug}-${index}`}>
                  <div
                    className="toc-panel-item-row"
                    style={{ paddingLeft: `${(heading.level - minLevel) * 14 + 4}px` }}
                  >
                    {isParent ? (
                      <button
                        type="button"
                        className="toc-panel-toggle"
                        onClick={() => toggleCollapse(heading.slug)}
                        title={isCollapsed ? "展开" : "折叠"}
                      >
                        <svg
                          width="10"
                          height="10"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`toc-toggle-arrow ${isCollapsed ? "" : "toc-toggle-arrow-expanded"}`}
                        >
                          <polyline points="9 6 15 12 9 18" />
                        </svg>
                      </button>
                    ) : (
                      <span className="toc-panel-toggle-spacer" />
                    )}

                    <button
                      type="button"
                      onClick={() => onClickHeading(heading)}
                      className="toc-panel-item"
                      title={heading.text}
                    >
                      <span className="toc-panel-item-marker" data-level={heading.level}>
                        {heading.level <= 2 ? "◆" : heading.level <= 4 ? "◇" : "·"}
                      </span>
                      <span className="toc-panel-item-text">{heading.text}</span>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export type { TocHeading };
