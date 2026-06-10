import { useReactFlow } from "@xyflow/react";
import { X } from "lucide-react";

/**
 * Bouton ✕ de suppression d'un nœud, posé sur le nœud (visible au survol).
 * Passe par `deleteElements` de React Flow → déclenche `onDelete` du graphe
 * (retrait du nœud + de ses liens, puis write-back dans le `.md`).
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
