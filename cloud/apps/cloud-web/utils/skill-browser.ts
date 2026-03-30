import type { LocalSkill, SkillFileRecord, SkillTreeDirectoryNode, SkillTreeNode } from "~/types/skills";

type MutableDirectoryNode = SkillTreeDirectoryNode & {
  children: Array<SkillTreeNode | MutableDirectoryNode>;
};

function sortTreeNodes(nodes: Array<SkillTreeNode | MutableDirectoryNode>): SkillTreeNode[] {
  return nodes
    .map((node) =>
      node.type === "directory"
        ? {
            ...node,
            children: sortTreeNodes(node.children)
          }
        : node
    )
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

export function buildSkillTree(files: SkillFileRecord[]): SkillTreeNode[] {
  const root: MutableDirectoryNode = {
    type: "directory",
    name: "",
    path: "",
    children: []
  };

  for (const file of files) {
    const segments = file.name.split("/").filter(Boolean);
    let current = root;

    segments.forEach((segment, index) => {
      const path = segments.slice(0, index + 1).join("/");
      const isFile = index === segments.length - 1;

      if (isFile) {
        current.children.push({
          type: "file",
          name: segment,
          path
        });
        return;
      }

      let next = current.children.find(
        (child): child is MutableDirectoryNode => child.type === "directory" && child.path === path
      );

      if (!next) {
        next = {
          type: "directory",
          name: segment,
          path,
          children: []
        };
        current.children.push(next);
      }

      current = next;
    });
  }

  return sortTreeNodes(root.children);
}

export function findEntryFile(skill: LocalSkill | null | undefined): SkillFileRecord | null {
  if (!skill) {
    return null;
  }

  return skill.files.find((file) => file.name.toLowerCase() === "skill.md") ?? skill.files[0] ?? null;
}
