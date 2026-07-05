import { useMemo } from "react";
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

// ---------- 组件 ----------

export function TocPanel({ content, onClickHeading, visible, onClose }: TocPanelProps) {
  const { t } = useTranslation();
  const headings = useMemo(() => parseHeadings(content), [content]);

  if (!visible) return null;

  // 计算最小层级，用于相对缩进
  // （如果文档从 ## 开始，则 ## 不缩进，### 缩进 1 级）
  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  return (
    <div className="toc-panel">
      <div className="toc-panel-header">
        <span className="toc-panel-title">
          {t("main.toc.title", { defaultValue: "目录" })}
        </span>
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

      <div className="toc-panel-body">
        {headings.length === 0 ? (
          <p className="toc-panel-empty">
            {t("main.toc.empty", { defaultValue: "暂无标题" })}
          </p>
        ) : (
          <ul className="toc-panel-list">
            {headings.map((heading, index) => (
              <li key={`${heading.slug}-${index}`}>
                <button
                  type="button"
                  onClick={() => onClickHeading(heading)}
                  className="toc-panel-item"
                  style={{ paddingLeft: `${(heading.level - minLevel) * 14 + 8}px` }}
                  title={heading.text}
                >
                  <span className="toc-panel-item-marker" data-level={heading.level}>
                    {heading.level <= 2 ? "◆" : heading.level <= 4 ? "◇" : "·"}
                  </span>
                  <span className="toc-panel-item-text">{heading.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export type { TocHeading };
