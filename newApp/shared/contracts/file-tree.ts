/** Skill 目录的文件树节点 */
export type FileTreeNode = {
  name: string;
  relativePath: string;
  type: "file" | "directory";
  children?: FileTreeNode[];
};
