const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { authenticate, authorize } = require('../middleware/auth');
const { ROLES } = require('../config/constants');

// Routes pour les tâches (admin uniquement pour la gestion)
router.get('/', authenticate, taskController.getActiveTasks);
router.get('/all', authenticate, authorize(ROLES.ADMIN), taskController.getAllTasks);
router.get('/:id', authenticate, taskController.getTaskById);

router.use((req, res, next) => {
  console.log('🔍 Headers Content-Type:', req.headers['content-type']);
  console.log('🔍 Raw body (avant parsing):', req.body);
  console.log('🔍 req.body type:', typeof req.body);
  console.log('🔍 req.body keys:', Object.keys(req.body));
  next();
});

router.post('/', 
  authenticate, 
  authorize(ROLES.ADMIN),
  (req, res, next) => {
    console.log('📦 Après authentification:', req.body);
    next();
  },
  taskController.createTask
);


router.put('/:id', 
  authenticate, 
  authorize(ROLES.ADMIN), 
  taskController.updateTask
);

router.delete('/:id', 
  authenticate, 
  authorize(ROLES.ADMIN), 
  taskController.deleteTask
);

router.delete('/:id/hard', 
  authenticate, 
  authorize(ROLES.ADMIN), 
  taskController.hardDeleteTask
);

// Routes pour les évaluations (formateurs)
router.post('/evaluations',
  authenticate,
  authorize(ROLES.FORMATEUR),
  taskController.evaluateTask
);

router.get('/evaluations/replay/:replayId',
  authenticate,
  taskController.getEvaluationsByReplay
);

router.get('/evaluations/stagiaire/:stagiaireId',
  authenticate,
  taskController.getEvaluationsByStagiaire
);

router.get('/evaluations/status/:replayId/:stagiaireId',
  authenticate,
  authorize(ROLES.FORMATEUR),
  taskController.getEvaluationStatus
);

router.delete('/evaluations/:id',
  authenticate,
  authorize(ROLES.FORMATEUR),
  taskController.deleteEvaluation
);

module.exports = router;