import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, UserPlus, Wand2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { ROLE_LABEL, useMe, type AppRole } from "@/lib/session";
import { createStaffUser, resetStaffPassword } from "@/lib/users.functions";

interface StaffRow {
  id: string;
  fullName: string;
  email: string | null;
  isActive: boolean;
  createdAt: string;
  role: AppRole | null;
}

function randomPassword() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export function UsersPanel() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<StaffRow | null>(null);

  const users = useQuery({
    queryKey: ["staff"],
    queryFn: async (): Promise<StaffRow[]> => {
      const [p, r] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, is_active, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
      ]);
      if (p.error) throw p.error;
      if (r.error) throw r.error;
      const roles = new Map((r.data ?? []).map((x) => [x.user_id, x.role as AppRole]));
      return (p.data ?? []).map((u) => ({
        id: u.id,
        fullName: u.full_name || "(sin nombre)",
        email: u.email,
        isActive: u.is_active,
        createdAt: u.created_at,
        role: roles.get(u.id) ?? null,
      }));
    },
  });

  const setRole = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: AppRole }) => {
      const { error } = await supabase.rpc("set_user_role", { _user_id: id, _role: role });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Rol actualizado");
      qc.invalidateQueries({ queryKey: ["staff"] });
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const setActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.rpc("set_user_active", { _user_id: id, _active: active });
      if (error) throw error;
    },
    onSuccess: (_d, v) => {
      toast.success(v.active ? "Acceso activado" : "Acceso desactivado");
      qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  return (
    <div className="surface-card p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Personal autorizado</h2>
          <p className="text-sm text-muted-foreground">
            Solo las cuentas creadas aquí pueden entrar. Nadie puede elegir ni cambiar su propio rol.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <UserPlus /> Nuevo usuario
        </Button>
      </div>

      <div className="mt-5 grid gap-2">
        {users.isLoading && (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" /> Cargando usuarios…
          </p>
        )}
        {users.isError && (
          <p role="alert" className="rounded-2xl bg-destructive/10 p-4 text-sm text-destructive">
            {friendlyError(users.error)}
          </p>
        )}
        {users.data?.map((u) => {
          const isMe = u.id === me?.id;
          return (
            <div
              key={u.id}
              className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:flex-row md:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{u.fullName}</span>
                  {isMe && <Badge variant="outline">Tú</Badge>}
                  {!u.role && <Badge variant="warning">Sin rol · sin acceso</Badge>}
                  {!u.isActive && <Badge variant="destructive">Desactivado</Badge>}
                </div>
                <p className="truncate text-sm text-muted-foreground">{u.email}</p>
                <p className="text-xs text-muted-foreground">Alta: {formatDate(u.createdAt)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="grid gap-1">
                  <Label className="sr-only" htmlFor={`role-${u.id}`}>
                    Rol de {u.fullName}
                  </Label>
                  <Select
                    value={u.role ?? ""}
                    onValueChange={(v) => setRole.mutate({ id: u.id, role: v as AppRole })}
                    disabled={setRole.isPending}
                  >
                    <SelectTrigger id={`role-${u.id}`} className="w-44 rounded-full">
                      <SelectValue placeholder="Asignar rol" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">{ROLE_LABEL.admin}</SelectItem>
                      <SelectItem value="editor">{ROLE_LABEL.editor}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={u.isActive}
                    disabled={isMe || setActive.isPending}
                    onCheckedChange={(active) => setActive.mutate({ id: u.id, active })}
                    aria-label={`Acceso de ${u.fullName}`}
                  />
                  {u.isActive ? "Activo" : "Inactivo"}
                </label>
                <Button variant="outline" size="sm" onClick={() => setResetting(u)}>
                  <KeyRound /> Contraseña
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {creating && <CreateUserDialog onClose={() => setCreating(false)} />}
      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

const createSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre").max(120),
  email: z.string().trim().email("Correo inválido").max(255),
  password: z.string().min(8, "Mínimo 8 caracteres").max(72),
  role: z.enum(["admin", "editor"]),
});

function CreateUserDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const create = useServerFn(createStaffUser);
  const [form, setForm] = useState({ fullName: "", email: "", password: randomPassword(), role: "editor" as AppRole });
  const [errors, setErrors] = useState<Partial<Record<"fullName" | "email" | "password" | "role" | "form", string>>>({});
  const [done, setDone] = useState(false);

  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof createSchema>) => create({ data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff"] });
      setDone(true);
    },
    onError: (e) => setErrors({ form: friendlyError(e) }),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = createSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        {done ? (
          <>
            <DialogHeader>
              <DialogTitle>Cuenta creada</DialogTitle>
              <DialogDescription>
                Comparte estos datos con {form.fullName} por un medio seguro. La contraseña no se
                volverá a mostrar.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1 rounded-2xl bg-muted p-4 font-mono text-sm">
              <span>Correo: {form.email}</span>
              <span>Contraseña temporal: {form.password}</span>
              <span>Rol: {ROLE_LABEL[form.role]}</span>
            </div>
            <DialogFooter>
              <Button onClick={onClose}>Listo</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Nuevo usuario</DialogTitle>
              <DialogDescription>La cuenta queda confirmada y lista para entrar.</DialogDescription>
            </DialogHeader>
            <FormField id="nu-name" label="Nombre completo" error={errors.fullName}>
              <Input id="nu-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} autoFocus />
            </FormField>
            <FormField id="nu-email" label="Correo electrónico" error={errors.email}>
              <Input id="nu-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </FormField>
            <FormField id="nu-pass" label="Contraseña temporal" error={errors.password}>
              <div className="flex gap-2">
                <Input id="nu-pass" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="font-mono" />
                <Button type="button" variant="outline" size="icon" onClick={() => setForm({ ...form, password: randomPassword() })} aria-label="Generar otra contraseña">
                  <Wand2 />
                </Button>
              </div>
            </FormField>
            <FormField id="nu-role" label="Rol" error={errors.role}>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                <SelectTrigger id="nu-role" className="rounded-2xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor — captura y consulta, sin costos</SelectItem>
                  <SelectItem value="admin">Administrador — acceso completo</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
            {errors.form && (
              <p role="alert" className="text-sm text-destructive">
                {errors.form}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending && <Loader2 className="animate-spin" />} Crear cuenta
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: StaffRow; onClose: () => void }) {
  const reset = useServerFn(resetStaffPassword);
  const [password, setPassword] = useState(randomPassword());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mutation = useMutation({
    mutationFn: () => reset({ data: { userId: user.id, password } }),
    onSuccess: () => setDone(true),
    onError: (e) => setError(friendlyError(e)),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-3xl">
        <DialogHeader>
          <DialogTitle>Nueva contraseña para {user.fullName}</DialogTitle>
          <DialogDescription>
            {done
              ? "Listo. Comparte la contraseña por un medio seguro; no se volverá a mostrar."
              : "Asigna una contraseña temporal. La persona podrá cambiarla después con «¿Olvidaste tu contraseña?»."}
          </DialogDescription>
        </DialogHeader>
        {done ? (
          <div className="rounded-2xl bg-muted p-4 font-mono text-sm">{password}</div>
        ) : (
          <FormField id="rp-pass" label="Contraseña temporal" error={error ?? undefined}>
            <div className="flex gap-2">
              <Input id="rp-pass" value={password} onChange={(e) => setPassword(e.target.value)} className="font-mono" />
              <Button type="button" variant="outline" size="icon" onClick={() => setPassword(randomPassword())} aria-label="Generar otra contraseña">
                <Wand2 />
              </Button>
            </div>
          </FormField>
        )}
        <DialogFooter>
          {done ? (
            <Button onClick={onClose}>Listo</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Cancelar
              </Button>
              <Button
                disabled={mutation.isPending}
                onClick={() => (password.length < 8 ? setError("Mínimo 8 caracteres") : mutation.mutate())}
              >
                {mutation.isPending && <Loader2 className="animate-spin" />} Guardar
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FormField({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
