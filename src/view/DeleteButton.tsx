import { useReactFlow } from "@xyflow/react";
import { X } from "lucide-react";

/**
 * ✕ button to delete a node, placed on the node (visible on hover).
 * Goes through React Flow's `deleteElements` → triggers the graph's `onDelete`
 * (removal of the node + its links, then write-back into the `.md`).
 */
export function DeleteButton({ id }: { id: string }) {
  const { deleteElements } = useReactFlow();
  return (
    <button
      className="sfy-del nodrag nopan"
      title="Delete this node"
      onClick={(e) => {
        e.stopPropagation();
        void deleteElements({ nodes: [{ id }] });
      }}
    >
      <X size={11} />
    </button>
  );
}
