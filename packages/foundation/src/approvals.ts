export interface ApprovalStep {
  roles: string[];
  approvals: Array<{ userId: string; role: string }>;
}

export function approveStep(
  steps: ApprovalStep[],
  stepIndex: number,
  requesterId: string,
  approverId: string,
  approverRoles: string[],
): ApprovalStep[] {
  if (requesterId === approverId)
    throw new Error('A requester cannot approve their own request');
  if (
    steps.some((step) =>
      step.approvals.some((approval) => approval.userId === approverId),
    )
  ) {
    throw new Error('An approver can only approve once per request');
  }
  const step = steps[stepIndex];
  if (!step || !step.roles.some((role) => approverRoles.includes(role))) {
    throw new Error('Approver does not meet the required role for this step');
  }
  if (step.approvals.length)
    throw new Error('This approval step is already complete');
  return steps.map((item, index) =>
    index === stepIndex
      ? {
          ...item,
          approvals: [
            {
              userId: approverId,
              role: step.roles.find((role) => approverRoles.includes(role))!,
            },
          ],
        }
      : item,
  );
}

export function allStepsApproved(steps: ApprovalStep[]): boolean {
  return steps.every((step) => step.approvals.length > 0);
}
