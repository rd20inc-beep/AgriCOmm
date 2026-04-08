const db = require('../../config/database');
const emailService = require('../../services/emailService');
const whatsappService = require('../../services/whatsappService');
const notificationService = require('../../services/notificationService');
const automationService = require('../../services/automationService');

async function generateTaskNo(trx) {
  const last = await (trx || db)('tasks_assignments')
    .select('task_no')
    .orderBy('created_at', 'desc')
    .first();

  if (!last || !last.task_no) {
    return 'TSK-001';
  }

  // Handle auto-generated task_nos (TSK-AUTO-xxx)
  const match = last.task_no.match(/^TSK-(\d+)$/);
  const num = match ? parseInt(match[1], 10) : 0;
  return `TSK-${String(num + 1).padStart(3, '0')}`;
}

const communicationController = {
  // ============================================================
  // Email
  // ============================================================
  async sendEmail(req, res) {
    try {
      const { to, cc, subject, body, templateSlug, variables, linked_type, linked_id } = req.body;

      if (!to) {
        return res.status(400).json({ success: false, message: 'to email address is required.' });
      }
      if (!templateSlug && !subject) {
        return res.status(400).json({ success: false, message: 'subject is required when not using a template.' });
      }

      const log = await emailService.sendEmail({
        to,
        cc: cc || null,
        subject: subject || null,
        body: body || null,
        templateSlug: templateSlug || null,
        variables: variables || {},
        linkedType: linked_type || null,
        linkedId: linked_id || null,
        userId: req.user.id,
      });

      return res.json({ success: true, data: { emailLog: log } });
    } catch (err) {
      console.error('Send email error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getEmailLogs(req, res) {
    try {
      const { linked_type, linked_id, customer_id, page, limit } = req.query;

      if (customer_id) {
        const result = await emailService.getEmailsByCustomer(parseInt(customer_id), {
          page: page || 1,
          limit: limit || 20,
        });
        return res.json({ success: true, data: result });
      }

      const result = await emailService.getEmailLog({
        linkedType: linked_type || null,
        linkedId: linked_id || null,
        page: page || 1,
        limit: limit || 20,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Get email logs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getEmailLogsByEntity(req, res) {
    try {
      const { type, id } = req.params;
      const { page, limit } = req.query;

      const result = await emailService.getEmailLog({
        linkedType: type,
        linkedId: parseInt(id),
        page: page || 1,
        limit: limit || 20,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Get email logs by entity error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // Email Templates
  // ============================================================
  async listTemplates(req, res) {
    try {
      const templates = await db('email_templates').orderBy('name', 'asc');
      return res.json({ success: true, data: { templates } });
    } catch (err) {
      console.error('List templates error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createTemplate(req, res) {
    try {
      const { name, slug, subject_template, body_template, available_variables, entity } = req.body;

      if (!name || !slug || !subject_template || !body_template) {
        return res.status(400).json({
          success: false,
          message: 'name, slug, subject_template, and body_template are required.',
        });
      }

      const [template] = await db('email_templates')
        .insert({
          name,
          slug,
          subject_template,
          body_template,
          available_variables: available_variables ? JSON.stringify(available_variables) : null,
          entity: entity || null,
          created_by: req.user.id,
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { template } });
    } catch (err) {
      console.error('Create template error:', err);
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Template with this name or slug already exists.' });
      }
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateTemplate(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      delete updates.id;
      delete updates.created_at;
      delete updates.created_by;

      if (updates.available_variables && typeof updates.available_variables !== 'string') {
        updates.available_variables = JSON.stringify(updates.available_variables);
      }

      updates.updated_at = db.fn.now();

      const [template] = await db('email_templates')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!template) {
        return res.status(404).json({ success: false, message: 'Template not found.' });
      }

      return res.json({ success: true, data: { template } });
    } catch (err) {
      console.error('Update template error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // Comments
  // ============================================================
  async listComments(req, res) {
    try {
      const { type, id } = req.params;

      const comments = await db('comments as cm')
        .leftJoin('users as u', 'cm.user_id', 'u.id')
        .where({ 'cm.linked_type': type, 'cm.linked_id': parseInt(id) })
        .select('cm.*', 'u.full_name as user_name')
        .orderBy('cm.created_at', 'desc');

      return res.json({ success: true, data: { comments } });
    } catch (err) {
      console.error('List comments error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async addComment(req, res) {
    try {
      const { linked_type, linked_id, comment, is_internal, mentioned_users } = req.body;

      if (!linked_type || !linked_id || !comment) {
        return res.status(400).json({
          success: false,
          message: 'linked_type, linked_id, and comment are required.',
        });
      }

      const [result] = await db('comments')
        .insert({
          linked_type,
          linked_id: parseInt(linked_id),
          user_id: req.user.id,
          comment,
          is_internal: is_internal != null ? is_internal : true,
          mentioned_users: mentioned_users ? JSON.stringify(mentioned_users) : null,
        })
        .returning('*');

      // Notify mentioned users
      if (mentioned_users && Array.isArray(mentioned_users)) {
        for (const mentionedId of mentioned_users) {
          await db('notifications').insert({
            user_id: mentionedId,
            title: 'You were mentioned in a comment',
            message: `${req.user.full_name || 'A user'} mentioned you in a comment on ${linked_type} #${linked_id}`,
            type: 'mention',
            linked_ref: `${linked_type}-${linked_id}`,
          });
        }
      }

      return res.status(201).json({ success: true, data: { comment: result } });
    } catch (err) {
      console.error('Add comment error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async deleteComment(req, res) {
    try {
      const { id } = req.params;

      const comment = await db('comments').where({ id }).first();
      if (!comment) {
        return res.status(404).json({ success: false, message: 'Comment not found.' });
      }

      // Only allow the author or admin to delete
      if (comment.user_id !== req.user.id && req.user.role_id !== 1) {
        return res.status(403).json({ success: false, message: 'Not authorized to delete this comment.' });
      }

      await db('comments').where({ id }).del();

      return res.json({ success: true, message: 'Comment deleted.' });
    } catch (err) {
      console.error('Delete comment error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // Task Assignments
  // ============================================================
  async listMyTasks(req, res) {
    try {
      const { status, priority, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('tasks_assignments as ta')
        .leftJoin('users as assignee', 'ta.assigned_to', 'assignee.id')
        .leftJoin('users as assigner', 'ta.assigned_by', 'assigner.id')
        .where('ta.assigned_to', req.user.id)
        .select(
          'ta.*',
          'assignee.full_name as assigned_to_name',
          'assigner.full_name as assigned_by_name'
        );

      if (status) query = query.where('ta.status', status);
      if (priority) query = query.where('ta.priority', priority);

      const countQuery = query.clone().clearSelect().clearOrder().count('ta.id as total').first();

      const [tasks, countResult] = await Promise.all([
        query.orderBy('ta.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          tasks,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('List my tasks error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async listAssignedByMe(req, res) {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('tasks_assignments as ta')
        .leftJoin('users as assignee', 'ta.assigned_to', 'assignee.id')
        .where('ta.assigned_by', req.user.id)
        .select('ta.*', 'assignee.full_name as assigned_to_name');

      if (status) query = query.where('ta.status', status);

      const countQuery = query.clone().clearSelect().clearOrder().count('ta.id as total').first();

      const [tasks, countResult] = await Promise.all([
        query.orderBy('ta.created_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          tasks,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('List assigned by me error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createTask(req, res) {
    try {
      const { title, description, linked_type, linked_id, assigned_to, priority, due_date } = req.body;

      if (!title) {
        return res.status(400).json({ success: false, message: 'title is required.' });
      }

      const taskNo = await generateTaskNo();

      const [task] = await db('tasks_assignments')
        .insert({
          task_no: taskNo,
          title,
          description: description || null,
          linked_type: linked_type || null,
          linked_id: linked_id || null,
          assigned_to: assigned_to || null,
          assigned_by: req.user.id,
          priority: priority || 'Normal',
          due_date: due_date || null,
          status: 'Open',
        })
        .returning('*');

      // Notify assigned user
      if (assigned_to) {
        await db('notifications').insert({
          user_id: assigned_to,
          title: 'New Task Assigned',
          message: `You have been assigned task ${taskNo}: ${title}`,
          type: 'task',
          linked_ref: taskNo,
        });
      }

      return res.status(201).json({ success: true, data: { task } });
    } catch (err) {
      console.error('Create task error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateTask(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;

      delete updates.id;
      delete updates.task_no;
      delete updates.created_at;
      delete updates.assigned_by;

      updates.updated_at = db.fn.now();

      const [task] = await db('tasks_assignments')
        .where({ id })
        .update(updates)
        .returning('*');

      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found.' });
      }

      return res.json({ success: true, data: { task } });
    } catch (err) {
      console.error('Update task error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async completeTask(req, res) {
    try {
      const { id } = req.params;

      const [task] = await db('tasks_assignments')
        .where({ id })
        .update({
          status: 'Completed',
          completed_at: db.fn.now(),
          updated_at: db.fn.now(),
        })
        .returning('*');

      if (!task) {
        return res.status(404).json({ success: false, message: 'Task not found.' });
      }

      // Notify the assigner
      if (task.assigned_by) {
        await db('notifications').insert({
          user_id: task.assigned_by,
          title: 'Task Completed',
          message: `Task ${task.task_no}: "${task.title}" has been completed.`,
          type: 'task',
          linked_ref: task.task_no,
        });
      }

      return res.json({ success: true, data: { task } });
    } catch (err) {
      console.error('Complete task error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // Follow-ups
  // ============================================================
  async listFollowUps(req, res) {
    try {
      const { status, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('follow_ups as fu')
        .leftJoin('users as u', 'fu.user_id', 'u.id')
        .where('fu.user_id', req.user.id)
        .select('fu.*', 'u.full_name as user_name');

      if (status) query = query.where('fu.status', status);

      const countQuery = query.clone().clearSelect().clearOrder().count('fu.id as total').first();

      const [followUps, countResult] = await Promise.all([
        query.orderBy('fu.follow_up_date', 'asc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          followUps,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('List follow-ups error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createFollowUp(req, res) {
    try {
      const { linked_type, linked_id, follow_up_date, note } = req.body;

      if (!linked_type || !linked_id || !follow_up_date) {
        return res.status(400).json({
          success: false,
          message: 'linked_type, linked_id, and follow_up_date are required.',
        });
      }

      const [followUp] = await db('follow_ups')
        .insert({
          linked_type,
          linked_id: parseInt(linked_id),
          user_id: req.user.id,
          follow_up_date,
          note: note || null,
          status: 'Pending',
        })
        .returning('*');

      return res.status(201).json({ success: true, data: { followUp } });
    } catch (err) {
      console.error('Create follow-up error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async markFollowUpDone(req, res) {
    try {
      const { id } = req.params;

      const [followUp] = await db('follow_ups')
        .where({ id })
        .update({ status: 'Done' })
        .returning('*');

      if (!followUp) {
        return res.status(404).json({ success: false, message: 'Follow-up not found.' });
      }

      return res.json({ success: true, data: { followUp } });
    } catch (err) {
      console.error('Mark follow-up done error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // Notifications
  // ============================================================
  async listNotifications(req, res) {
    try {
      const { page, limit } = req.query;
      const result = await notificationService.getAll(req.user.id, {
        page: page || 1,
        limit: limit || 20,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('List notifications error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getNotificationCount(req, res) {
    try {
      const count = await notificationService.getCount(req.user.id);
      return res.json({ success: true, data: { unread: count } });
    } catch (err) {
      console.error('Get notification count error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async markNotificationRead(req, res) {
    try {
      const { id } = req.params;
      const notification = await notificationService.markRead(parseInt(id));

      if (!notification) {
        return res.status(404).json({ success: false, message: 'Notification not found.' });
      }

      return res.json({ success: true, data: { notification } });
    } catch (err) {
      console.error('Mark notification read error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async markAllNotificationsRead(req, res) {
    try {
      const result = await notificationService.markAllRead(req.user.id);
      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Mark all notifications read error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // WhatsApp Templates
  // ============================================================
  async listWhatsAppTemplates(req, res) {
    try {
      const templates = await whatsappService.getTemplates();
      return res.json({ success: true, data: { templates } });
    } catch (err) {
      console.error('List WhatsApp templates error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getWhatsAppTemplate(req, res) {
    try {
      const { id } = req.params;
      const template = await whatsappService.getTemplateById(parseInt(id));

      if (!template) {
        return res.status(404).json({ success: false, message: 'WhatsApp template not found.' });
      }

      return res.json({ success: true, data: { template } });
    } catch (err) {
      console.error('Get WhatsApp template error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async createWhatsAppTemplate(req, res) {
    try {
      const { name, slug, body_template } = req.body;

      if (!name || !slug || !body_template) {
        return res.status(400).json({
          success: false,
          message: 'name, slug, and body_template are required.',
        });
      }

      const template = await whatsappService.createTemplate({
        ...req.body,
        created_by: req.user.id,
      });

      return res.status(201).json({ success: true, data: { template } });
    } catch (err) {
      console.error('Create WhatsApp template error:', err);
      if (err.code === '23505') {
        return res.status(409).json({ success: false, message: 'Template with this slug already exists.' });
      }
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async updateWhatsAppTemplate(req, res) {
    try {
      const { id } = req.params;
      const template = await whatsappService.updateTemplate(parseInt(id), req.body);

      if (!template) {
        return res.status(404).json({ success: false, message: 'WhatsApp template not found.' });
      }

      return res.json({ success: true, data: { template } });
    } catch (err) {
      console.error('Update WhatsApp template error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async deleteWhatsAppTemplate(req, res) {
    try {
      const { id } = req.params;
      const template = await whatsappService.deleteTemplate(parseInt(id));

      if (!template) {
        return res.status(404).json({ success: false, message: 'WhatsApp template not found.' });
      }

      return res.json({ success: true, message: 'WhatsApp template deactivated.', data: { template } });
    } catch (err) {
      console.error('Delete WhatsApp template error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // WhatsApp Messaging
  // ============================================================
  async sendWhatsAppMessage(req, res) {
    try {
      const { to, to_name, body, template_slug, variables, linked_type, linked_id } = req.body;

      if (!to) {
        return res.status(400).json({ success: false, message: 'to (phone number) is required.' });
      }

      let log;

      if (template_slug) {
        // Send using template
        log = await whatsappService.sendTemplateMessage({
          templateSlug: template_slug,
          to,
          toName: to_name || null,
          variables: variables || {},
          linkedType: linked_type || null,
          linkedId: linked_id || null,
          sentBy: req.user.id,
        });
      } else {
        // Send custom message
        if (!body) {
          return res.status(400).json({
            success: false,
            message: 'body is required when not using a template.',
          });
        }

        let status = 'Sent';
        let errorMessage = null;
        let sentAt = new Date();

        try {
          const response = await whatsappService.sendMessage(to, body);
          if (!response.ok) {
            status = 'Failed';
            errorMessage = response.data
              ? JSON.stringify(response.data)
              : `HTTP ${response.status}: ${response.statusText}`;
          }
        } catch (err) {
          status = 'Failed';
          errorMessage = err.message || 'Unknown WhatsApp send error';
        }

        log = await whatsappService.logMessage({
          to_phone: to,
          to_name: to_name || null,
          template_used: null,
          body,
          linked_type: linked_type || null,
          linked_id: linked_id || null,
          status,
          error_message: errorMessage,
          sent_by: req.user.id,
          sent_at: status === 'Sent' ? sentAt : null,
        });
      }

      return res.json({ success: true, data: { log } });
    } catch (err) {
      console.error('Send WhatsApp message error:', err);
      return res.status(500).json({ success: false, message: err.message || 'Internal server error.' });
    }
  },

  async previewWhatsAppTemplate(req, res) {
    try {
      const { template_slug, template_id, variables } = req.body;

      const lookup = template_slug || template_id;
      if (!lookup) {
        return res.status(400).json({
          success: false,
          message: 'template_slug or template_id is required.',
        });
      }

      const template = await whatsappService.getTemplate(lookup);
      if (!template) {
        return res.status(404).json({ success: false, message: 'WhatsApp template not found.' });
      }

      const preview = whatsappService.renderTemplate(template, variables || {});

      return res.json({
        success: true,
        data: {
          template_name: template.name,
          template_slug: template.slug,
          available_variables: template.available_variables,
          preview,
        },
      });
    } catch (err) {
      console.error('Preview WhatsApp template error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getWhatsAppLogs(req, res) {
    try {
      const { linked_type, linked_id, status, page, limit } = req.query;

      const result = await whatsappService.getLogs({
        linkedType: linked_type || null,
        linkedId: linked_id ? parseInt(linked_id) : null,
        status: status || null,
        page: page || 1,
        limit: limit || 20,
      });

      return res.json({ success: true, data: result });
    } catch (err) {
      console.error('Get WhatsApp logs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  // ============================================================
  // Scheduled Tasks (admin)
  // ============================================================
  async listScheduledTasks(req, res) {
    try {
      const tasks = await db('scheduled_tasks').orderBy('name', 'asc');
      return res.json({ success: true, data: { tasks } });
    } catch (err) {
      console.error('List scheduled tasks error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async toggleScheduledTask(req, res) {
    try {
      const { id } = req.params;

      const task = await db('scheduled_tasks').where({ id }).first();
      if (!task) {
        return res.status(404).json({ success: false, message: 'Scheduled task not found.' });
      }

      const [updated] = await db('scheduled_tasks')
        .where({ id })
        .update({ is_active: !task.is_active, updated_at: db.fn.now() })
        .returning('*');

      return res.json({ success: true, data: { task: updated } });
    } catch (err) {
      console.error('Toggle scheduled task error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async runScheduledTask(req, res) {
    try {
      const { id } = req.params;

      const task = await db('scheduled_tasks').where({ id }).first();
      if (!task) {
        return res.status(404).json({ success: false, message: 'Scheduled task not found.' });
      }

      const result = await automationService.runTask(parseInt(id));

      return res.json({ success: true, data: { execution: result } });
    } catch (err) {
      console.error('Run scheduled task error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },

  async getExecutionLogs(req, res) {
    try {
      const { task_id, page = 1, limit = 20 } = req.query;
      const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

      let query = db('task_execution_log as tel')
        .leftJoin('scheduled_tasks as st', 'tel.task_id', 'st.id')
        .select('tel.*', 'st.name as task_name');

      if (task_id) query = query.where('tel.task_id', parseInt(task_id));

      const countQuery = query.clone().clearSelect().clearOrder().count('tel.id as total').first();

      const [logs, countResult] = await Promise.all([
        query.orderBy('tel.started_at', 'desc').limit(parseInt(limit)).offset(offset),
        countQuery,
      ]);

      const total = parseInt(countResult.total);

      return res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            totalPages: Math.ceil(total / parseInt(limit)),
          },
        },
      });
    } catch (err) {
      console.error('Get execution logs error:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }
  },
};

module.exports = communicationController;
