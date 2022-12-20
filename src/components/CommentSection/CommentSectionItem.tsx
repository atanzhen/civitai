import { Group, Stack, Text, Textarea, Button, Menu, ActionIcon } from '@mantine/core';
import { openConfirmModal } from '@mantine/modals';
import { showNotification, hideNotification } from '@mantine/notifications';
import { ReportReason } from '@prisma/client';
import { IconDotsVertical, IconTrash, IconEdit, IconFlag } from '@tabler/icons';
import { useState } from 'react';

import { LoginRedirect } from '~/components/LoginRedirect/LoginRedirect';
import { ReactionPicker } from '~/components/ReactionPicker/ReactionPicker';
import { UserAvatar } from '~/components/UserAvatar/UserAvatar';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { ReactionDetails } from '~/server/selectors/reaction.selector';
import { CommentGetCommentsById } from '~/types/router';
import { daysFromNow } from '~/utils/date-helpers';
import { showErrorNotification, showSuccessNotification } from '~/utils/notifications';
import { trpc } from '~/utils/trpc';

export function CommentSectionItem({ comment, modelId }: Props) {
  const currentUser = useCurrentUser();
  const queryUtils = trpc.useContext();

  const [editComment, setEditComment] = useState<Props['comment'] | null>(null);

  const { data: reactions = [] } = trpc.comment.getReactions.useQuery(
    { commentId: comment.id },
    { initialData: comment.reactions }
  );

  const saveCommentMutation = trpc.comment.upsert.useMutation({
    async onSuccess() {
      await queryUtils.review.getCommentsById.invalidate();
      await queryUtils.comment.getCommentsById.invalidate();
      setEditComment(null);
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
        title: 'Could not save comment',
      });
    },
  });

  const deleteMutation = trpc.comment.delete.useMutation({
    async onMutate() {
      await queryUtils.review.getCommentsCount.cancel();
      await queryUtils.comment.getCommentsCount.cancel();
      const { reviewId, parentId } = comment;

      if (reviewId) {
        const prevCount = queryUtils.review.getCommentsCount.getData({ id: reviewId }) ?? 0;
        queryUtils.review.getCommentsCount.setData({ id: reviewId }, (old = 0) =>
          old > 0 ? old - 1 : old
        );

        return { prevCount };
      }

      if (parentId) {
        const prevCount = queryUtils.comment.getCommentsCount.getData({ id: parentId }) ?? 0;
        queryUtils.comment.getCommentsCount.setData({ id: parentId }, (old = 0) =>
          old > 0 ? old - 1 : old
        );

        return { prevCount };
      }

      return {};
    },
    async onSuccess() {
      await queryUtils.review.getCommentsById.invalidate();
      await queryUtils.comment.getCommentsById.invalidate();
    },
    onError(error, _variables, context) {
      const { reviewId, parentId } = comment;

      if (reviewId)
        queryUtils.review.getCommentsCount.setData({ id: reviewId }, context?.prevCount);
      if (parentId)
        queryUtils.comment.getCommentsCount.setData({ id: parentId }, context?.prevCount);

      showErrorNotification({
        error: new Error(error.message),
        title: 'Could not delete comment',
      });
    },
  });
  const handleDeleteComment = (id: number) => {
    openConfirmModal({
      title: 'Delete Comment',
      children: (
        <Text size="sm">
          Are you sure you want to delete this comment? This action is destructive and cannot be
          reverted.
        </Text>
      ),
      centered: true,
      labels: { confirm: 'Delete Comment', cancel: "No, don't delete it" },
      confirmProps: { color: 'red', loading: deleteMutation.isLoading },
      onConfirm: () => {
        deleteMutation.mutate({ id });
      },
    });
  };

  const reportMutation = trpc.comment.report.useMutation({
    onMutate() {
      showNotification({
        id: 'sending-comment-report',
        loading: true,
        disallowClose: true,
        autoClose: false,
        message: 'Sending report...',
      });
    },
    async onSuccess() {
      await queryUtils.review.getCommentsById.invalidate();
      await queryUtils.comment.getCommentsById.invalidate();

      showSuccessNotification({
        title: 'Comment reported',
        message: 'Your request has been received',
      });
    },
    onError(error) {
      showErrorNotification({
        error: new Error(error.message),
        title: 'Unable to send report',
        reason: 'An unexpected error occurred, please try again',
      });
    },
    onSettled() {
      hideNotification('sending-comment-report');
    },
  });
  const handleReportComment = (id: number, reason: ReportReason) => {
    reportMutation.mutate({ id, reason });
  };

  const toggleReactionMutation = trpc.comment.toggleReaction.useMutation({
    async onMutate({ id, reaction }) {
      await queryUtils.comment.getReactions.cancel({ commentId: comment.id });

      const previousReactions =
        queryUtils.comment.getReactions.getData({ commentId: comment.id }) ?? [];
      const latestReaction =
        previousReactions.length > 0 ? previousReactions[previousReactions.length - 1] : { id: 0 };

      if (currentUser) {
        const newReaction: ReactionDetails = {
          id: latestReaction.id + 1,
          reaction,
          user: {
            id: currentUser.id,
            name: currentUser.name ?? '',
            username: currentUser.username ?? '',
            image: currentUser.image ?? '',
          },
        };
        const reacted = previousReactions.find(
          (r) => r.reaction === reaction && r.user.id === currentUser.id
        );
        queryUtils.comment.getReactions.setData({ commentId: id }, (old = []) =>
          reacted
            ? old.filter((oldReaction) => oldReaction.id !== reacted.id)
            : [...old, newReaction]
        );
      }

      return { previousReactions };
    },
    onError(_error, _variables, context) {
      queryUtils.comment.getReactions.setData(
        { commentId: comment.id },
        context?.previousReactions
      );
    },
  });

  const isOwner = currentUser?.id === comment.user.id;
  const isMod = currentUser?.isModerator ?? false;
  const isEditing = editComment?.id === comment.id;

  return (
    <Group align="flex-start" position="apart" noWrap>
      <Group align="flex-start" sx={{ flex: '1 1 0' }} noWrap>
        <UserAvatar user={comment.user} size="md" />
        <Stack spacing="xs" sx={{ flex: '1 1 0' }}>
          <Stack spacing={0}>
            <Group spacing={8} align="center">
              <Text size="sm" weight="bold">
                {comment.user.username}
              </Text>
              <Text color="dimmed" size="xs">
                {daysFromNow(comment.createdAt)}
              </Text>
            </Group>
            {!isEditing ? (
              <Text size="sm">{comment.content}</Text>
            ) : (
              <Textarea
                value={editComment.content}
                disabled={editComment && saveCommentMutation.isLoading}
                onChange={(e) =>
                  setEditComment((state) => (state ? { ...state, content: e.target.value } : state))
                }
              />
            )}
          </Stack>
          {!isEditing ? (
            <ReactionPicker
              reactions={reactions}
              onSelect={(reaction) => toggleReactionMutation.mutate({ id: comment.id, reaction })}
            />
          ) : (
            <Group position="right">
              <Button variant="default" size="xs" onClick={() => setEditComment(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => saveCommentMutation.mutate({ ...comment, ...editComment, modelId })}
                size="xs"
                loading={editComment && saveCommentMutation.isLoading}
              >
                Comment
              </Button>
            </Group>
          )}
        </Stack>
      </Group>
      <Menu position="bottom-end">
        <Menu.Target>
          <ActionIcon size="xs" variant="subtle">
            <IconDotsVertical size={14} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {isOwner || isMod ? (
            <>
              <Menu.Item
                icon={<IconTrash size={14} stroke={1.5} />}
                onClick={() => handleDeleteComment(comment.id)}
                color="red"
              >
                Delete comment
              </Menu.Item>
              <Menu.Item
                icon={<IconEdit size={14} stroke={1.5} />}
                onClick={() => setEditComment(comment)}
              >
                Edit comment
              </Menu.Item>
            </>
          ) : null}
          {!currentUser || !isOwner ? (
            <>
              <LoginRedirect reason="report-comment">
                <Menu.Item
                  icon={<IconFlag size={14} stroke={1.5} />}
                  onClick={() => handleReportComment(comment.id, ReportReason.NSFW)}
                >
                  Report as NSFW
                </Menu.Item>
              </LoginRedirect>
              <LoginRedirect reason="report-comment">
                <Menu.Item
                  icon={<IconFlag size={14} stroke={1.5} />}
                  onClick={() => handleReportComment(comment.id, ReportReason.TOSViolation)}
                >
                  Report as Terms Violation
                </Menu.Item>
              </LoginRedirect>
            </>
          ) : null}
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

type Props = {
  comment: CommentGetCommentsById[number];
  modelId: number;
};
