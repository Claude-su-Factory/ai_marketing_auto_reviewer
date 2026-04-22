import { useEffect, useState } from "react";
import { exec } from "child_process";

export interface WorkerStatus { active: boolean; checkedAt: number; }

export function useWorkerStatus(): WorkerStatus {
  const [status, setStatus] = useState<WorkerStatus>({ active: false, checkedAt: 0 });
  useEffect(() => {
    const check = () => {
      exec("launchctl list com.adai.worker", (err, stdout) => {
        if (err || !stdout.trim()) { setStatus({ active: false, checkedAt: Date.now() }); return; }
        const firstLine = stdout.split("\n")[0] ?? "";
        const [pid] = firstLine.split("\t");
        setStatus({ active: Number(pid) > 0, checkedAt: Date.now() });
      });
    };
    check();
    const id = setInterval(check, 60_000);
    return () => clearInterval(id);
  }, []);
  return status;
}
