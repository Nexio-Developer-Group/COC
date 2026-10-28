"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useApi } from "@/lib/client/api";
import DocumentView from "@/components/DocumentView";
import UploadDialog from "@/components/UploadDialog";
import { Button, EmptyState, PageHeader, Spinner } from "@/components/ui";

export default function RequirementsPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading } = useApi<{ tender: { title: string; requirements_doc_id: string | null }; bids: unknown[] }>(`/api/tenders/${id}`);
  const [upload, setUpload] = useState(false);
  if (isLoading && !data) return <div className="py-20 text-center"><Spinner className="w-6 h-6" /></div>;
  const reqId = data?.tender.requirements_doc_id;
  return (
    <div>
      <PageHeader title="Requirements" subtitle="Your bill of quantities — every bid is compared against this. Anything can be edited; every change is tracked." />
      {!reqId ? (
        <EmptyState icon="upload" title="Upload your BOQ" text="Excel with several sheets is fine — every sheet is read and merged into one list. Pictures inside the file are kept." action={<Button variant="primary" icon="upload" onClick={() => setUpload(true)}>Upload requirements</Button>} />
      ) : (
        <DocumentView tenderId={id} documentId={reqId} role="tender" />
      )}
      {upload && <UploadDialog tenderId={id} role="tender" open onClose={() => setUpload(false)} onDone={() => location.reload()} />}
    </div>
  );
}
